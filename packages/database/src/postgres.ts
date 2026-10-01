import pg from "pg";
import { isDeepStrictEqual } from "node:util";
import {
  type CandidateAsset,
  type PaperOrder,
  type Position,
  type PortfolioSnapshot,
  type SystemEvent,
  type TradeProposal,
  type TokenRiskAssessment,
  type PolicyAssessment,
  type OpportunityScore,
  type ResearchBrief,
  type SignalResult,
  type WalletCredibilityScore,
  type SentinelSignal,
  type AlertRule,
  type AlertEvent,
  AlertEventSchema,
  type BacktestResult,
  type WatchlistItem,
  CandidateAssetSchema,
  PaperOrderSchema,
  PositionSchema,
  PortfolioSnapshotSchema,
  SystemEventSchema,
  TradeProposalSchema,
  TokenRiskAssessmentSchema,
  PolicyAssessmentSchema,
  OpportunityScoreSchema,
  ResearchBriefSchema,
  SignalResultSchema,
} from "@sat/shared";
import type { ExperimentResult } from "@sat/experiments";
import { createInitialPortfolio } from "@sat/portfolio";
import { STORE_SCHEMA_SQL, STORE_SCHEMA_VERSION } from "./schema-sql";
import type { Database, StoreSnapshot, StoredSignal, FillUnitOfWork, MarkUnitOfWork, AlertCooldown } from "./types";
import { AlreadyExecutedError, StalePortfolioError, validateAlertCooldown } from "./types";
import { newId } from "@sat/shared";

const { Pool } = pg;
const MAX_ALERT_EVENT_FACTS = 100_000;

/** Remote databases use verified TLS by default; local CI URLs stay plaintext. */
export function buildPoolConfig(connectionString: string): pg.PoolConfig {
  let url: URL;
  try { url = new URL(connectionString); } catch { throw new Error("DATABASE_URL_INVALID"); }
  const local = !url.hostname || ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname.toLowerCase());
  const tls = process.env.DATABASE_SSL === "true" || (!local && process.env.DATABASE_SSL !== "false");
  const rejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false";
  const sslmode = url.searchParams.get("sslmode")?.toLowerCase();
  const libpqCompat = url.searchParams.get("uselibpqcompat") === "true";
  if (tls && (sslmode === "disable" || url.searchParams.get("ssl") === "0")) {
    throw new Error("DATABASE_TLS_REQUIRED");
  }
  if (tls && rejectUnauthorized && (
    sslmode === "no-verify" || url.searchParams.get("ssl") === "no-verify" ||
    (libpqCompat && ["require", "prefer", "verify-ca"].includes(sslmode ?? ""))
  )) {
    throw new Error("DATABASE_TLS_VERIFICATION_REQUIRED");
  }
  // pg parses SSL query parameters after PoolConfig and can replace our TLS
  // settings. Keep credentials and other parameters, but make this policy the
  // single source of truth for SSL mode and certificate verification.
  if (tls) {
    url.searchParams.delete("sslmode");
    url.searchParams.delete("uselibpqcompat");
    url.searchParams.delete("ssl");
  }
  return {
    connectionString: tls ? url.toString() : connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 8),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    ssl: tls ? { rejectUnauthorized } : undefined,
  };
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

export class PostgresDatabase implements Database {
  readonly mode = "postgres" as const;
  private readonly pool: pg.Pool;
  private ready: Promise<void> | null = null;
  private readonly startingCapital: number;
  private parseErrorCount = 0;

  constructor(
    connectionString: string,
    startingCapital = Number(process.env.PAPER_STARTING_CAPITAL_USD ?? 100_000),
    private readonly alertFactCapacity = MAX_ALERT_EVENT_FACTS,
  ) {
    if (!Number.isSafeInteger(alertFactCapacity) || alertFactCapacity < 1 || alertFactCapacity > MAX_ALERT_EVENT_FACTS) {
      throw new Error("ALERT_EVENT_CAPACITY_INVALID");
    }
    this.startingCapital = startingCapital;
    this.pool = new Pool(buildPoolConfig(connectionString));
    this.pool.on("error", (err) => {
      const rawCode = (err as Error & { code?: unknown }).code;
      const code = typeof rawCode === "string" && /^[A-Z0-9_]{2,16}$/.test(rawCode)
        ? rawCode : "UNKNOWN";
      console.error("sat postgres pool error", code);
    });
  }

  private async ensure(): Promise<void> {
    if (!this.ready) {
      this.ready = this.bootstrap().catch((err) => {
        this.ready = null;
        throw err;
      });
    }
    await this.ready;
  }

  private async bootstrap(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("set local lock_timeout = '5s'");
      await client.query("set local statement_timeout = '15s'");
      // Schema DDL and initial portfolio creation must be single-writer across instances.
      await client.query("select pg_advisory_xact_lock(20260930, 1)");
      await client.query("savepoint optional_extension");
      try {
        await client.query('create extension if not exists "pgcrypto"');
        await client.query("release savepoint optional_extension");
      } catch {
        await client.query("rollback to savepoint optional_extension");
      }
      await client.query(STORE_SCHEMA_SQL);
      const priorVersion = await client.query("select version from sat_schema_version where id = 1 for update");
      if (Number(priorVersion.rows[0]?.version ?? 0) > STORE_SCHEMA_VERSION) {
        throw new Error("sat-schema-newer-than-runtime");
      }
      await client.query(
        `insert into sat_schema_version (id, version) values (1, $1)
         on conflict (id) do update set version = greatest(sat_schema_version.version, excluded.version)`,
        [STORE_SCHEMA_VERSION],
      );
      const { snapshot, positions } = createInitialPortfolio(this.startingCapital);
      const port = await client.query(
        "insert into sat_portfolio (id, payload) values (1, $1::jsonb) on conflict (id) do nothing returning id",
        [snapshot],
      );
      if (port.rowCount) {
        await client.query(
          "insert into sat_equity (t, nav) values ($1, $2)",
          [snapshot.timestamp, snapshot.navUsd],
        );
        await client.query(
          "insert into sat_meta (k, payload) values ('startingCapital', $1::jsonb) on conflict (k) do nothing",
          [{ usd: this.startingCapital }],
        );
        for (const p of positions) {
          await client.query(
            "insert into sat_positions (id, mint, payload, updated_at) values ($1, $2, $3::jsonb, $4)",
            [p.id, p.mint, p, p.updatedAt],
          );
        }
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  async getState(): Promise<StoreSnapshot> {
    await this.ensure();
    const [
      candidates,
      proposals,
      orders,
      positions,
      portfolio,
      events,
      tokenRisk,
      policies,
      scores,
      research,
      experiments,
      signals,
      equity,
      intelRow,
    ] = await Promise.all([
      this.pool.query("select payload from sat_candidates"),
      this.pool.query("select payload from sat_proposals order by created_at desc"),
      this.pool.query("select payload from sat_orders order by created_at desc"),
      this.pool.query("select payload from sat_positions"),
      this.pool.query("select payload from sat_portfolio where id = 1"),
      this.pool.query("select payload from sat_events order by created_at desc limit 500"),
      this.pool.query("select payload from sat_token_risk"),
      this.pool.query("select payload from sat_policies"),
      this.pool.query("select payload from sat_scores"),
      this.pool.query("select payload from sat_research"),
      this.pool.query("select payload from sat_experiments order by created_at desc"),
      this.pool.query("select mint, payload from sat_signals order by created_at desc limit 500"),
      this.pool.query("select t, nav from sat_equity order by id asc limit 500"),
      this.pool.query("select payload from sat_meta where k = 'intel'"),
    ]);

    this.parseErrorCount = 0;
    const initial = createInitialPortfolio(this.startingCapital).snapshot;
    const parsedPortfolio = PortfolioSnapshotSchema.safeParse(portfolio.rows[0]?.payload);
    if (portfolio.rows[0] && !parsedPortfolio.success) this.parseErrorCount += 1;

    return {
      mode: "postgres",
      candidates: this.parseMany(candidates.rows, CandidateAssetSchema),
      proposals: this.parseMany(proposals.rows, TradeProposalSchema),
      orders: this.parseMany(orders.rows, PaperOrderSchema),
      positions: this.parseMany(positions.rows, PositionSchema),
      portfolio: parsedPortfolio.success ? parsedPortfolio.data : initial,
      events: this.parseMany(events.rows, SystemEventSchema),
      tokenRisk: this.parseMany(tokenRisk.rows, TokenRiskAssessmentSchema),
      policies: this.parseMany(policies.rows, PolicyAssessmentSchema),
      scores: this.parseMany(scores.rows, OpportunityScoreSchema),
      research: this.parseMany(research.rows, ResearchBriefSchema),
      experiments: experiments.rows.map((r) => r.payload as ExperimentResult),
      signals: signals.rows.flatMap((r) => {
        const parsed = SignalResultSchema.safeParse(r.payload);
        if (!parsed.success) {
          this.parseErrorCount += 1;
          return [];
        }
        return [{ mint: String(r.mint), ...parsed.data } satisfies StoredSignal];
      }),
      equityHistory: equity.rows.map((r) => ({
        t: r.t instanceof Date ? r.t.toISOString() : String(r.t),
        nav: num(r.nav),
      })),
      parseErrors: this.parseErrorCount,
      ...this.intelFromPayload(intelRow.rows[0]?.payload),
    };
  }

  private emptyIntel() {
    return {
      watchlist: [] as WatchlistItem[],
      walletScores: [] as WalletCredibilityScore[],
      sentinelSignals: [] as SentinelSignal[],
      alertRules: [] as AlertRule[],
      alertEvents: [] as AlertEvent[],
      backtests: [] as BacktestResult[],
    };
  }

  private intelFromPayload(payload: unknown) {
    if (!payload || typeof payload !== "object") return this.emptyIntel();
    const rec = payload as Record<string, unknown>;
    return {
      watchlist: Array.isArray(rec.watchlist) ? (rec.watchlist as WatchlistItem[]) : [],
      walletScores: Array.isArray(rec.walletScores)
        ? (rec.walletScores as WalletCredibilityScore[])
        : [],
      sentinelSignals: Array.isArray(rec.sentinelSignals)
        ? (rec.sentinelSignals as SentinelSignal[])
        : [],
      alertRules: Array.isArray(rec.alertRules) ? (rec.alertRules as AlertRule[]) : [],
      alertEvents: Array.isArray(rec.alertEvents) ? (rec.alertEvents as AlertEvent[]) : [],
      backtests: Array.isArray(rec.backtests) ? (rec.backtests as BacktestResult[]) : [],
    };
  }

  private async mutateIntel<T>(
    mutate: (intel: ReturnType<PostgresDatabase["emptyIntel"]>, client: pg.PoolClient) =>
      { patch: Partial<ReturnType<PostgresDatabase["emptyIntel"]>>; result: T } |
      Promise<{ patch: Partial<ReturnType<PostgresDatabase["emptyIntel"]>>; result: T }>,
  ): Promise<T> {
    await this.ensure();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("set local lock_timeout = '5s'");
      await client.query("set local statement_timeout = '15s'");
      // A plain SELECT FOR UPDATE cannot lock a missing row. Insert it first;
      // concurrent cold writers then wait on the primary-key conflict.
      await client.query("insert into sat_meta (k, payload) values ('intel', '{}'::jsonb) on conflict (k) do nothing");
      const row = await client.query("select payload from sat_meta where k = 'intel' for update");
      const raw = row.rows[0]?.payload;
      const intel = this.intelFromPayload(raw);
      const { patch, result } = await mutate(intel, client);
      await client.query("update sat_meta set payload = $1::jsonb where k = 'intel'", [
        { ...(raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}), ...patch },
      ]);
      await client.query("commit");
      return result;
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  async setCandidates(c: CandidateAsset[]): Promise<void> {
    await this.ensure();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from sat_candidates");
      for (const row of c) {
        await client.query(
          "insert into sat_candidates (mint, payload, updated_at) values ($1, $2::jsonb, now())",
          [row.mint, row],
        );
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  async addProposal(p: TradeProposal): Promise<void> {
    await this.ensure();
    await this.pool.query(
      `insert into sat_proposals (id, mint, payload, created_at)
       values ($1, $2, $3::jsonb, $4)
       on conflict (id) do update set payload = excluded.payload, mint = excluded.mint`,
      [p.id, p.mint, p, p.createdAt],
    );
  }

  async addOrder(o: PaperOrder): Promise<void> {
    await this.ensure();
    await this.pool.query(
      `insert into sat_orders (id, mint, payload, created_at)
       values ($1, $2, $3::jsonb, $4)
       on conflict (id) do update set payload = excluded.payload`,
      [o.id, o.mint, o, o.createdAt],
    );
  }

  async setPositions(p: Position[]): Promise<void> {
    await this.ensure();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from sat_positions");
      for (const row of p) {
        await client.query(
          "insert into sat_positions (id, mint, payload, updated_at) values ($1, $2, $3::jsonb, $4)",
          [row.id, row.mint, row, row.updatedAt],
        );
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  async setPortfolio(s: PortfolioSnapshot): Promise<void> {
    await this.ensure();
    await this.pool.query(
      `insert into sat_portfolio (id, payload) values (1, $1::jsonb)
       on conflict (id) do update set payload = excluded.payload`,
      [s],
    );
  }

  async addEvents(e: SystemEvent[]): Promise<void> {
    await this.ensure();
    for (const ev of e) {
      await this.pool.query(
        "insert into sat_events (id, payload, created_at) values ($1, $2::jsonb, $3) on conflict (id) do nothing",
        [ev.id, ev, ev.timestamp],
      );
    }
  }

  async addTokenRisk(a: TokenRiskAssessment): Promise<void> {
    await this.ensure();
    await this.pool.query(
      `insert into sat_token_risk (mint, payload, assessed_at) values ($1, $2::jsonb, $3)
       on conflict (mint) do update set payload = excluded.payload, assessed_at = excluded.assessed_at`,
      [a.mint, a, a.assessedAt],
    );
  }

  async addPolicy(a: PolicyAssessment): Promise<void> {
    await this.ensure();
    await this.pool.query(
      `insert into sat_policies (mint, payload, assessed_at) values ($1, $2::jsonb, $3)
       on conflict (mint) do update set payload = excluded.payload, assessed_at = excluded.assessed_at`,
      [a.mint, a, a.assessedAt],
    );
  }

  async addScore(s: OpportunityScore): Promise<void> {
    await this.ensure();
    await this.pool.query(
      `insert into sat_scores (mint, payload, scored_at) values ($1, $2::jsonb, $3)
       on conflict (mint) do update set payload = excluded.payload, scored_at = excluded.scored_at`,
      [s.mint, s, s.scoredAt],
    );
  }

  async addResearch(r: ResearchBrief): Promise<void> {
    await this.ensure();
    await this.pool.query(
      `insert into sat_research (mint, payload, generated_at) values ($1, $2::jsonb, $3)
       on conflict (mint) do update set payload = excluded.payload, generated_at = excluded.generated_at`,
      [r.mint, r, r.generatedAt],
    );
  }

  async addExperiment(e: ExperimentResult): Promise<void> {
    await this.ensure();
    await this.pool.query(
      `insert into sat_experiments (id, payload, created_at) values ($1, $2::jsonb, $3)
       on conflict (id) do update set payload = excluded.payload`,
      [e.experiment.id, e, e.experiment.createdAt],
    );
  }

  async addSignals(mint: string, signals: SignalResult[]): Promise<void> {
    await this.ensure();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from sat_signals where mint = $1", [mint]);
      for (const s of signals) {
        await client.query(
          "insert into sat_signals (id, mint, payload, created_at) values ($1, $2, $3::jsonb, $4)",
          [newId(), mint, s, s.timestamp],
        );
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  async pushEquity(nav: number): Promise<void> {
    await this.ensure();
    await this.pool.query("insert into sat_equity (t, nav) values (now(), $1)", [nav]);
  }

  async consumeProposalAndRecordFill(work: FillUnitOfWork): Promise<void> {
    await this.ensure();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      if (work.consumeProposal) {
        const consumed = await client.query(
          `update sat_proposals
             set payload = $1::jsonb
           where id = $2 and payload->>'status' = 'PROPOSED'
           returning id`,
          [work.proposal, work.proposalId],
        );
        if ((consumed.rowCount ?? 0) === 0) {
          throw new AlreadyExecutedError();
        }
      }
      // Serialize all portfolio writers on the singleton row, then reject fills
      // calculated from a state that another proposal or mark has changed.
      const currentPortfolio = await client.query(
        "select payload from sat_portfolio where id = 1 for update",
      );
      const currentPositions = await client.query(
        "select payload from sat_positions order by id",
      );
      const sorted = (positions: Position[]) => [...positions].sort((a, b) => a.id.localeCompare(b.id));
      if (
        !work.expectedPortfolio || !work.expectedPositions ||
        !isDeepStrictEqual(currentPortfolio.rows[0]?.payload, work.expectedPortfolio) ||
        !isDeepStrictEqual(
          currentPositions.rows.map((row) => row.payload),
          sorted(work.expectedPositions),
        )
      ) {
        throw new StalePortfolioError();
      }
      await client.query(
        `insert into sat_orders (id, mint, payload, created_at, proposal_id)
         values ($1, $2, $3::jsonb, $4, $5)
         on conflict (id) do update set payload = excluded.payload`,
        [
          work.order.id,
          work.order.mint,
          work.order,
          work.order.createdAt,
          work.consumeProposal ? work.proposalId : null,
        ],
      );
      await client.query(
        `insert into sat_portfolio (id, payload) values (1, $1::jsonb)
         on conflict (id) do update set payload = excluded.payload`,
        [work.snapshot],
      );
      await client.query("delete from sat_positions");
      for (const row of work.positions) {
        await client.query(
          "insert into sat_positions (id, mint, payload, updated_at) values ($1, $2, $3::jsonb, $4)",
          [row.id, row.mint, row, row.updatedAt],
        );
      }
      for (const ev of work.events) {
        await client.query(
          "insert into sat_events (id, payload, created_at) values ($1, $2::jsonb, $3) on conflict (id) do nothing",
          [ev.id, ev, ev.timestamp],
        );
      }
      await client.query("insert into sat_equity (t, nav) values (now(), $1)", [work.navUsd]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  async recordMarkToMarket(work: MarkUnitOfWork): Promise<void> {
    await this.ensure();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const currentPortfolio = await client.query(
        "select payload from sat_portfolio where id = 1 for update",
      );
      const currentPositions = await client.query(
        "select payload from sat_positions order by id",
      );
      const sorted = (positions: Position[]) => [...positions].sort((a, b) => a.id.localeCompare(b.id));
      if (
        !isDeepStrictEqual(currentPortfolio.rows[0]?.payload, work.expectedPortfolio) ||
        !isDeepStrictEqual(currentPositions.rows.map((row) => row.payload), sorted(work.expectedPositions))
      ) {
        throw new StalePortfolioError();
      }
      await client.query("delete from sat_positions");
      for (const row of work.positions) {
        await client.query(
          "insert into sat_positions (id, mint, payload, updated_at) values ($1, $2, $3::jsonb, $4)",
          [row.id, row.mint, row, row.updatedAt],
        );
      }
      await client.query(
        "update sat_portfolio set payload = $1::jsonb where id = 1",
        [work.snapshot],
      );
      await client.query(
        "insert into sat_equity (t, nav) values ($1, $2)",
        [work.snapshot.timestamp, work.navUsd],
      );
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  async reset(startingCapital: number): Promise<void> {
    await this.ensure();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      for (const table of [
        "sat_candidates",
        "sat_proposals",
        "sat_orders",
        "sat_positions",
        "sat_events",
        "sat_token_risk",
        "sat_policies",
        "sat_scores",
        "sat_research",
        "sat_experiments",
        "sat_signals",
        "sat_equity",
      ]) {
        await client.query(`delete from ${table}`);
      }
      const { snapshot, positions } = createInitialPortfolio(startingCapital);
      await client.query(
        `insert into sat_portfolio (id, payload) values (1, $1::jsonb)
         on conflict (id) do update set payload = excluded.payload`,
        [snapshot],
      );
      await client.query("insert into sat_equity (t, nav) values ($1, $2)", [
        snapshot.timestamp,
        snapshot.navUsd,
      ]);
      for (const p of positions) {
        await client.query(
          "insert into sat_positions (id, mint, payload, updated_at) values ($1, $2, $3::jsonb, $4)",
          [p.id, p.mint, p, p.updatedAt],
        );
      }
      await client.query("delete from sat_meta where k = 'intel'");
      await client.query("delete from sat_alert_event_facts");
      await client.query("delete from sat_alert_cooldowns");
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  async setWatchlist(items: WatchlistItem[]): Promise<void> {
    await this.mutateIntel(() => ({ patch: { watchlist: items }, result: undefined }));
  }
  async addWatchlistItem(item: WatchlistItem, maxItems: number): Promise<WatchlistItem> {
    return this.mutateIntel((intel) => {
      const existing = intel.watchlist.find((w) => w.kind === item.kind && w.address === item.address);
      if (existing) return { patch: {}, result: existing };
      if (intel.watchlist.length >= maxItems) throw new Error("WATCHLIST_LIMIT");
      return { patch: { watchlist: [item, ...intel.watchlist] }, result: item };
    });
  }
  async removeWatchlistItem(id: string): Promise<void> {
    await this.mutateIntel((intel) => ({
      patch: { watchlist: intel.watchlist.filter((w) => w.id !== id) }, result: undefined,
    }));
  }
  async setWalletScores(scores: WalletCredibilityScore[]): Promise<void> {
    await this.mutateIntel(() => ({ patch: { walletScores: scores.slice(0, 200) }, result: undefined }));
  }
  async upsertWalletScore(score: WalletCredibilityScore): Promise<void> {
    await this.mutateIntel((intel) => ({
      patch: { walletScores: [score, ...intel.walletScores.filter((s) => s.address !== score.address)].slice(0, 200) },
      result: undefined,
    }));
  }
  async setSentinelSignals(signals: SentinelSignal[]): Promise<void> {
    await this.mutateIntel(() => ({ patch: { sentinelSignals: signals.slice(0, 200) }, result: undefined }));
  }
  async addAlertRule(rule: AlertRule): Promise<void> {
    await this.mutateIntel((intel) => ({
      patch: { alertRules: [rule, ...intel.alertRules.filter((r) => r.id !== rule.id)].slice(0, 100) },
      result: undefined,
    }));
  }
  async addAlertEvents(events: AlertEvent[]): Promise<void> {
    await this.mutateIntel((intel) => {
      const ids = new Set(events.map((event) => event.id));
      const seen = new Set<string>();
      const unique = events.filter((event) => {
        if (seen.has(event.id)) return false;
        seen.add(event.id);
        return true;
      });
      return {
        patch: { alertEvents: [...unique, ...intel.alertEvents.filter((event) => !ids.has(event.id))].slice(0, 500) },
        result: undefined,
      };
    });
  }
  async recordAlertEvent(event: AlertEvent, cooldown?: AlertCooldown): Promise<AlertEvent> {
    return this.mutateIntel(async (intel, client) => {
      const fact = await client.query("select payload from sat_alert_event_facts where id = $1", [event.id]);
      if (fact.rowCount) return { patch: {}, result: fact.rows[0]!.payload as AlertEvent };
      // mutateIntel holds the intel row lock across this count and insertion,
      // so concurrent instances cannot admit a fact beyond the hard cap.
      const count = await client.query("select count(*)::int as n from sat_alert_event_facts");
      if (Number(count.rows[0]?.n) >= this.alertFactCapacity) throw new Error("ALERT_EVENT_CAPACITY");
      const inHistory = intel.alertEvents.find((saved) => saved.id === event.id);
      if (inHistory) {
        await client.query("insert into sat_alert_event_facts (id, payload) values ($1, $2::jsonb)", [inHistory.id, inHistory]);
        return { patch: {}, result: inHistory };
      }
      const parsed = AlertEventSchema.parse(event);
      const gate = validateAlertCooldown(parsed, cooldown);
      let recorded = parsed;
      if (gate) {
        await client.query("delete from sat_alert_cooldowns where expires_at <= clock_timestamp()");
        const active = await client.query(
          "select 1 from sat_alert_cooldowns where k = $1 and expires_at > clock_timestamp()",
          [gate.key],
        );
        if (active.rowCount) {
          recorded = { ...parsed, delivered: false, suppressedReason: "cooldown" };
        } else {
          const count = await client.query("select count(*)::int as n from sat_alert_cooldowns");
          if (Number(count.rows[0]?.n) >= 10_000) {
            recorded = { ...parsed, delivered: false, suppressedReason: "cooldown-capacity" };
          } else {
            await client.query("insert into sat_alert_cooldowns (k, expires_at) values ($1, $2)", [gate.key, gate.expiresAt]);
          }
        }
      }
      await client.query("insert into sat_alert_event_facts (id, payload) values ($1, $2::jsonb)", [recorded.id, recorded]);
      return {
        patch: { alertEvents: [recorded, ...intel.alertEvents.filter((saved) => saved.id !== recorded.id)].slice(0, 500) },
        result: recorded,
      };
    });
  }
  async addBacktest(result: BacktestResult): Promise<void> {
    await this.mutateIntel((intel) => ({
      patch: { backtests: [result, ...intel.backtests.filter((r) => r.id !== result.id)].slice(0, 50) },
      result: undefined,
    }));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private parseMany<T>(
    rows: Array<{ payload: unknown }>,
    schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
  ): T[] {
    const out: T[] = [];
    for (const row of rows) {
      const parsed = schema.safeParse(row.payload);
      if (parsed.success) out.push(parsed.data);
      else this.parseErrorCount += 1;
    }
    return out;
  }
}
