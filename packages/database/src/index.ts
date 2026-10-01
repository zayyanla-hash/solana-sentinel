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
} from "@sat/shared";
import type { ExperimentResult } from "@sat/experiments";
import { createInitialPortfolio } from "@sat/portfolio";
import { isDeepStrictEqual } from "node:util";
import type { Database, StoreSnapshot, StoredSignal, FillUnitOfWork, MarkUnitOfWork, AlertCooldown } from "./types";
import { AlreadyExecutedError, StalePortfolioError, validateAlertCooldown } from "./types";
import { PostgresDatabase } from "./postgres";

export type { Database, StoreSnapshot, StoredSignal, FillUnitOfWork, MarkUnitOfWork, AlertCooldown };

const MAX_ALERT_EVENT_FACTS = 100_000;

export class InMemoryDatabase implements Database {
  readonly mode = "memory" as const;
  private state: StoreSnapshot;
  private tail: Promise<void> = Promise.resolve();
  private readonly alertFacts = new Map<string, AlertEvent>();
  private readonly alertCooldowns = new Map<string, number>();

  constructor(
    startingCapital = Number(process.env.PAPER_STARTING_CAPITAL_USD ?? 100_000),
    private readonly alertFactCapacity = MAX_ALERT_EVENT_FACTS,
  ) {
    if (!Number.isSafeInteger(alertFactCapacity) || alertFactCapacity < 1 || alertFactCapacity > MAX_ALERT_EVENT_FACTS) {
      throw new Error("ALERT_EVENT_CAPACITY_INVALID");
    }
    this.state = emptyState(startingCapital, "memory");
  }

  private enqueue<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async getState(): Promise<StoreSnapshot> {
    return structuredClone(this.state);
  }

  async setCandidates(c: CandidateAsset[]) {
    this.state.candidates = c;
  }
  async addProposal(p: TradeProposal) {
    this.state.proposals = [p, ...this.state.proposals.filter((x) => x.id !== p.id)];
  }
  async addOrder(o: PaperOrder) {
    this.state.orders.unshift(o);
  }
  async setPositions(p: Position[]) {
    this.state.positions = p;
  }
  async setPortfolio(s: PortfolioSnapshot) {
    this.state.portfolio = s;
  }
  async addEvents(e: SystemEvent[]) {
    this.state.events.unshift(...e);
  }
  async addTokenRisk(a: TokenRiskAssessment) {
    this.state.tokenRisk = [a, ...this.state.tokenRisk.filter((x) => x.mint !== a.mint)].slice(
      0,
      200,
    );
  }
  async addPolicy(a: PolicyAssessment) {
    this.state.policies = [a, ...this.state.policies.filter((x) => x.mint !== a.mint)].slice(
      0,
      200,
    );
  }
  async addScore(s: OpportunityScore) {
    this.state.scores = [s, ...this.state.scores.filter((x) => x.mint !== s.mint)].slice(0, 200);
  }
  async addResearch(r: ResearchBrief) {
    this.state.research = [r, ...this.state.research.filter((x) => x.mint !== r.mint)].slice(
      0,
      200,
    );
  }
  async addExperiment(e: ExperimentResult) {
    this.state.experiments.unshift(e);
  }
  async addSignals(mint: string, signals: SignalResult[]) {
    this.state.signals = [
      ...signals.map((s) => ({ mint, ...s }) satisfies StoredSignal),
      ...this.state.signals.filter((x) => x.mint !== mint),
    ].slice(0, 500);
  }
  async pushEquity(nav: number) {
    this.state.equityHistory.push({ t: new Date().toISOString(), nav });
  }

  async consumeProposalAndRecordFill(work: FillUnitOfWork): Promise<void> {
    return this.enqueue(async () => {
      if (work.consumeProposal) {
        const current = this.state.proposals.find((p) => p.id === work.proposalId);
        if (!current || current.status !== "PROPOSED") {
          throw new AlreadyExecutedError();
        }
      }
      const sorted = (positions: Position[]) => [...positions].sort((a, b) => a.id.localeCompare(b.id));
      if (
        !work.expectedPortfolio || !work.expectedPositions ||
        !isDeepStrictEqual(this.state.portfolio, work.expectedPortfolio) ||
        !isDeepStrictEqual(sorted(this.state.positions), sorted(work.expectedPositions))
      ) {
        throw new StalePortfolioError();
      }
      if (work.consumeProposal) {
        this.state.proposals = [
          work.proposal,
          ...this.state.proposals.filter((x) => x.id !== work.proposalId),
        ];
      }
      this.state.orders.unshift(work.order);
      this.state.portfolio = work.snapshot;
      this.state.positions = work.positions;
      this.state.events.unshift(...work.events);
      this.state.equityHistory.push({ t: new Date().toISOString(), nav: work.navUsd });
    });
  }
  async recordMarkToMarket(work: MarkUnitOfWork): Promise<void> {
    return this.enqueue(() => {
      const sorted = (positions: Position[]) => [...positions].sort((a, b) => a.id.localeCompare(b.id));
      if (
        !isDeepStrictEqual(this.state.portfolio, work.expectedPortfolio) ||
        !isDeepStrictEqual(sorted(this.state.positions), sorted(work.expectedPositions))
      ) {
        throw new StalePortfolioError();
      }
      this.state.positions = work.positions;
      this.state.portfolio = work.snapshot;
      this.state.equityHistory.push({ t: work.snapshot.timestamp, nav: work.navUsd });
    });
  }
  async reset(startingCapital: number) {
    await this.enqueue(() => {
      this.state = emptyState(startingCapital, "memory");
      this.alertFacts.clear();
      this.alertCooldowns.clear();
    });
  }
  async setWatchlist(items: WatchlistItem[]) {
    await this.enqueue(() => { this.state.watchlist = structuredClone(items); });
  }
  async addWatchlistItem(item: WatchlistItem, maxItems: number): Promise<WatchlistItem> {
    return this.enqueue(() => {
      const existing = this.state.watchlist.find((w) => w.kind === item.kind && w.address === item.address);
      if (existing) return structuredClone(existing);
      if (this.state.watchlist.length >= maxItems) throw new Error("WATCHLIST_LIMIT");
      this.state.watchlist.unshift(structuredClone(item));
      return structuredClone(item);
    });
  }
  async removeWatchlistItem(id: string): Promise<void> {
    await this.enqueue(() => { this.state.watchlist = this.state.watchlist.filter((w) => w.id !== id); });
  }
  async setWalletScores(scores: WalletCredibilityScore[]) {
    await this.enqueue(() => { this.state.walletScores = structuredClone(scores.slice(0, 200)); });
  }
  async upsertWalletScore(score: WalletCredibilityScore): Promise<void> {
    await this.enqueue(() => {
      this.state.walletScores = [structuredClone(score), ...this.state.walletScores.filter((s) => s.address !== score.address)].slice(0, 200);
    });
  }
  async setSentinelSignals(signals: SentinelSignal[]) {
    await this.enqueue(() => { this.state.sentinelSignals = structuredClone(signals.slice(0, 200)); });
  }
  async addAlertRule(rule: AlertRule) {
    await this.enqueue(() => {
      if (this.state.alertRules.length >= 100 && !this.state.alertRules.some((r) => r.id === rule.id)) throw new Error("ALERT_RULE_LIMIT");
      this.state.alertRules = [structuredClone(rule), ...this.state.alertRules.filter((r) => r.id !== rule.id)].slice(0, 100);
    });
  }
  async updateAlertRule(id: string, patch: Partial<Pick<AlertRule, "name" | "enabled" | "wallet" | "mint" | "cooldownMinutes">>): Promise<void> {
    await this.enqueue(() => {
      if (!this.state.alertRules.some((r) => r.id === id)) throw new Error("RULE_NOT_FOUND");
      this.state.alertRules = this.state.alertRules.map((r) => r.id === id ? { ...r, ...patch } : r);
    });
  }
  async deleteAlertRule(id: string): Promise<void> {
    await this.enqueue(() => { this.state.alertRules = this.state.alertRules.filter((r) => r.id !== id); });
  }
  async addAlertEvents(events: AlertEvent[]): Promise<void> {
    await this.enqueue(() => {
      const ids = new Set(events.map((event) => event.id));
      const seen = new Set<string>();
      const unique = events.filter((event) => {
        if (seen.has(event.id)) return false;
        seen.add(event.id);
        return true;
      });
      this.state.alertEvents = [
        ...structuredClone(unique),
        ...this.state.alertEvents.filter((event) => !ids.has(event.id)),
      ].slice(0, 500);
    });
  }
  async recordAlertEvent(event: AlertEvent, cooldown?: AlertCooldown): Promise<AlertEvent> {
    return this.enqueue(() => {
      const existing = this.alertFacts.get(event.id);
      if (existing) return structuredClone(existing);
      if (this.alertFacts.size >= this.alertFactCapacity) throw new Error("ALERT_EVENT_CAPACITY");
      const inHistory = this.state.alertEvents.find((saved) => saved.id === event.id);
      if (inHistory) {
        this.alertFacts.set(inHistory.id, structuredClone(inHistory));
        return structuredClone(inHistory);
      }
      const parsed = AlertEventSchema.parse(event);
      const gate = validateAlertCooldown(parsed, cooldown);
      let recorded = parsed;
      if (gate) {
        const now = Date.now();
        for (const [key, expiry] of this.alertCooldowns) {
          if (expiry <= now) this.alertCooldowns.delete(key);
        }
        if ((this.alertCooldowns.get(gate.key) ?? 0) > now) {
          recorded = { ...parsed, delivered: false, suppressedReason: "cooldown" };
        } else if (this.alertCooldowns.size >= 10_000) {
          recorded = { ...parsed, delivered: false, suppressedReason: "cooldown-capacity" };
        } else {
          this.alertCooldowns.set(gate.key, Date.parse(gate.expiresAt));
        }
      }
      const stored = structuredClone(recorded);
      this.alertFacts.set(stored.id, stored);
      this.state.alertEvents = [stored, ...this.state.alertEvents.filter((saved) => saved.id !== stored.id)].slice(0, 500);
      return structuredClone(stored);
    });
  }
  async addBacktest(result: BacktestResult) {
    await this.enqueue(() => {
      this.state.backtests = [structuredClone(result), ...this.state.backtests.filter((r) => r.id !== result.id)].slice(0, 50);
    });
  }
}

function emptyState(startingCapital: number, mode: StoreSnapshot["mode"]): StoreSnapshot {
  const { snapshot, positions } = createInitialPortfolio(startingCapital);
  return {
    mode,
    candidates: [],
    proposals: [],
    orders: [],
    positions,
    portfolio: snapshot,
    events: [],
    tokenRisk: [],
    policies: [],
    scores: [],
    research: [],
    experiments: [],
    signals: [],
    equityHistory: [{ t: snapshot.timestamp, nav: snapshot.navUsd }],
    parseErrors: 0,
    watchlist: [],
    walletScores: [],
    sentinelSignals: [],
    alertRules: [],
    alertEvents: [],
    backtests: [],
  };
}

let singleton: Database | null = null;

export function databaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL?.trim();
  return url ? url : undefined;
}

export function getDatabase(): Database {
  if (!singleton) {
    const url = databaseUrl();
    singleton = url
      ? new PostgresDatabase(url)
      : new InMemoryDatabase();
  }
  return singleton;
}

export function resetDatabaseForTests(startingCapital = 100_000): InMemoryDatabase {
  const mem = new InMemoryDatabase(startingCapital);
  singleton = mem;
  return mem;
}

export async function closeDatabaseForTests(): Promise<void> {
  if (singleton && singleton instanceof PostgresDatabase) {
    await singleton.close();
  }
  singleton = null;
}

export const closeDatabase = closeDatabaseForTests;

export { PostgresDatabase, buildPoolConfig } from "./postgres";
export { AlreadyExecutedError, StalePortfolioError };
export { STORE_SCHEMA_SQL, STORE_SCHEMA_VERSION } from "./schema-sql";
export { PostgresIngestionStore, IngestionStoreError, INGESTION_SCHEMA_SQL } from "./ingestion";
export type { IngestionCheckpoint, ChainObservation, IngestionStats, PendingTradeAlert } from "./ingestion";
export { PostgresDeliveryStore, DELIVERY_SCHEMA_SQL } from "./delivery";
export type { TelegramDelivery, TelegramDestination, ClaimedTelegramDelivery, TelegramSendResult as DeliverySendResult } from "./delivery";

export { PostgresTeamStore, getTeamStore, TEAM_SCHEMA_SQL } from "./team";
export type { TeamMember } from "./team";
