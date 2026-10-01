import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import pg from "pg";
import { SolanaAddressSchema, WalletTradeSchema, type WalletTrade } from "@sat/shared";
import { buildPoolConfig } from "./postgres";

const { Pool } = pg;

export interface IngestionCheckpoint {
  anchor: string | null;
  target: string | null;
  /** When the pending head was first observed; absent in pre-upgrade checkpoints. */
  targetObservedAt?: string | null;
  before: string | null;
  coverage: "BOOTSTRAP_WINDOW" | "CATCHING_UP" | "CURRENT";
  lastSuccessAt: string | null;
  lastError: string | null;
  version: number;
}

export interface ChainObservation {
  wallet: string;
  signature: string;
  slot: number;
  blockTime: number | null;
  outcome: "CLASSIFIED" | "UNKNOWN" | "FAILED";
  reason: string;
  raw: Record<string, unknown>;
  trades: WalletTrade[];
}

export interface IngestionStats {
  wallets: number;
  observations: number;
  trades: number;
  pendingAlerts: number;
  outcomes: Record<ChainObservation["outcome"], number>;
  coverage: Record<IngestionCheckpoint["coverage"], number>;
  archivedObservations: number;
  observationCapacityPercent: number;
  outboxCapacityPercent: number;
}

export interface StoredObservation { wallet: string; signature: string; slot: number; raw: Record<string, unknown> }
export interface InterpretationRevision {
  wallet: string; signature: string; version: number; outcome: ChainObservation["outcome"];
  reason: string; trades: WalletTrade[];
}

export interface PendingTradeAlert { wallet: string; signature: string; trade: WalletTrade }

export class IngestionStoreError extends Error {
  constructor(readonly code: string) { super(code); this.name = "IngestionStoreError"; }
}

export const INGESTION_SCHEMA_SQL = `
create table if not exists sat_ingestion_wallets (
  wallet text primary key,
  state jsonb not null,
  version int not null default 0 check (version >= 0)
);
create table if not exists sat_chain_observations (
  wallet text not null,
  signature text not null,
  slot bigint not null,
  hash text not null,
  payload jsonb not null,
  ingested_at timestamptz not null default now(),
  primary key (wallet, signature)
);
alter table sat_chain_observations add column if not exists ingested_at timestamptz not null default now();
create table if not exists sat_chain_archive (
  wallet text not null,
  signature text not null,
  slot bigint not null,
  hash text not null,
  payload_gzip bytea not null,
  archived_at timestamptz not null default now(),
  primary key (wallet, signature)
);
create index if not exists sat_chain_archive_wallet_slot_idx on sat_chain_archive (wallet, slot desc);
create table if not exists sat_chain_interpretations (
  wallet text not null,
  signature text not null,
  parser_version int not null check (parser_version > 0),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (wallet, signature, parser_version)
);
create index if not exists sat_chain_observations_wallet_slot_idx on sat_chain_observations (wallet, slot desc);
create table if not exists sat_chain_trades (
  wallet text not null,
  signature text not null,
  payload jsonb not null,
  primary key (wallet, signature)
);
create index if not exists sat_chain_trades_wallet_time_idx on sat_chain_trades (wallet, (payload->>'timestamp') desc);
create table if not exists sat_trade_alert_outbox (
  wallet text not null,
  signature text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (wallet, signature)
);
create index if not exists sat_trade_alert_outbox_pending_idx on sat_trade_alert_outbox (created_at, wallet, signature);
alter table sat_ingestion_wallets enable row level security;
alter table sat_chain_observations enable row level security;
alter table sat_chain_archive enable row level security;
alter table sat_chain_interpretations enable row level security;
alter table sat_chain_trades enable row level security;
alter table sat_trade_alert_outbox enable row level security;
`;

const INITIAL: Omit<IngestionCheckpoint, "version"> = {
  anchor: null, target: null, targetObservedAt: null, before: null, coverage: "BOOTSTRAP_WINDOW",
  lastSuccessAt: null, lastError: null,
};
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function validSignature(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 64 || value.length > 88) return false;
  let n = 0n;
  for (const c of value) {
    const digit = BASE58.indexOf(c);
    if (digit < 0) return false;
    n = n * 58n + BigInt(digit);
  }
  let bytes = 0;
  while (n > 0n) { bytes += 1; n >>= 8n; }
  return bytes + (value.match(/^1*/)?.[0].length ?? 0) === 64;
}

function bounded(value: number | undefined, fallback: number, ceiling: number): number {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < 1 || n > ceiling) throw new IngestionStoreError("INGESTION_INVALID_LIMIT");
  return n;
}

function canonical(value: unknown): string {
  const normalized = JSON.parse(JSON.stringify(value)) as unknown;
  const sorted = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sorted);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, child]) => [k, sorted(child)]));
    }
    return v;
  };
  return JSON.stringify(sorted(normalized));
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function parseNext(next: Omit<IngestionCheckpoint, "version">): Omit<IngestionCheckpoint, "version"> {
  if (!next || !["BOOTSTRAP_WINDOW", "CATCHING_UP", "CURRENT"].includes(next.coverage)) {
    throw new IngestionStoreError("INGESTION_INVALID_CHECKPOINT");
  }
  for (const key of ["anchor", "target", "before"] as const) {
    if (next[key] !== null && !validSignature(next[key])) throw new IngestionStoreError("INGESTION_INVALID_CHECKPOINT");
  }
  if (next.lastSuccessAt !== null && (typeof next.lastSuccessAt !== "string" || !Number.isFinite(Date.parse(next.lastSuccessAt)))) {
    throw new IngestionStoreError("INGESTION_INVALID_CHECKPOINT");
  }
  if (next.targetObservedAt != null &&
    (typeof next.targetObservedAt !== "string" || !Number.isFinite(Date.parse(next.targetObservedAt)))) {
    throw new IngestionStoreError("INGESTION_INVALID_CHECKPOINT");
  }
  if (next.target === null && next.targetObservedAt != null) throw new IngestionStoreError("INGESTION_INVALID_CHECKPOINT");
  if (next.lastError !== null && (typeof next.lastError !== "string" || next.lastError.length > 1024)) {
    throw new IngestionStoreError("INGESTION_INVALID_CHECKPOINT");
  }
  return { anchor: next.anchor, target: next.target, targetObservedAt: next.targetObservedAt ?? null,
    before: next.before, coverage: next.coverage,
    lastSuccessAt: next.lastSuccessAt, lastError: next.lastError };
}

function parseRows(wallet: string, rows: ChainObservation[]): ChainObservation[] {
  if (!Array.isArray(rows) || rows.length > 1000) throw new IngestionStoreError("INGESTION_INVALID_PAGE");
  let pageBytes = 0;
  return rows.map((row) => {
    if (row.wallet !== wallet || !validSignature(row.signature) || !Number.isSafeInteger(row.slot) || row.slot < 0 ||
      (row.blockTime !== null && (!Number.isSafeInteger(row.blockTime) || row.blockTime < 0)) ||
      !["CLASSIFIED", "UNKNOWN", "FAILED"].includes(row.outcome) || typeof row.reason !== "string" || row.reason.length > 512 ||
      !row.raw || typeof row.raw !== "object" || Array.isArray(row.raw) || !Array.isArray(row.trades)) {
      throw new IngestionStoreError("INGESTION_INVALID_OBSERVATION");
    }
    const trades = row.trades.map((trade) => {
      const parsed = WalletTradeSchema.safeParse(trade);
      if (!parsed.success || parsed.data.sourceSignature !== row.signature) throw new IngestionStoreError("INGESTION_INVALID_TRADE");
      return parsed.data;
    });
    let normalized: ChainObservation;
    try { normalized = JSON.parse(JSON.stringify({ ...row, trades })) as ChainObservation; }
    catch { throw new IngestionStoreError("INGESTION_INVALID_OBSERVATION"); }
    const bytes = Buffer.byteLength(canonical(normalized), "utf8");
    if (bytes > 1024 * 1024) throw new IngestionStoreError("INGESTION_OBSERVATION_TOO_LARGE");
    pageBytes += bytes;
    if (pageBytes > 16 * 1024 * 1024) throw new IngestionStoreError("INGESTION_PAGE_TOO_LARGE");
    return normalized;
  });
}

export class PostgresIngestionStore {
  private readonly pool: pg.Pool;
  private ready: Promise<void> | null = null;
  private readonly maxWallets: number;
  private readonly maxObservations: number;
  private readonly maxOutbox: number;

  constructor(connectionString: string, options: { maxWallets?: number; maxObservations?: number; maxOutbox?: number } = {}) {
    this.maxWallets = bounded(options.maxWallets, 200, 200);
    this.maxObservations = bounded(options.maxObservations, 100_000, 1_000_000);
    this.maxOutbox = bounded(options.maxOutbox, 100_000, 1_000_000);
    this.pool = new Pool({ ...buildPoolConfig(connectionString), statement_timeout: 15_000, lock_timeout: 5_000 });
    this.pool.on("error", (err) => {
      const rawCode = (err as Error & { code?: unknown }).code;
      const code = typeof rawCode === "string" && /^[A-Z0-9_]{2,16}$/.test(rawCode)
        ? rawCode : "UNKNOWN";
      console.error("sat ingestion postgres pool error", code);
    });
  }

  private async ensure(): Promise<void> {
    if (!this.ready) this.ready = this.bootstrap().catch((err) => { this.ready = null; throw err; });
    await this.ready;
  }

  private async bootstrap(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("set local lock_timeout = '5s'");
      await client.query("set local statement_timeout = '15s'");
      await client.query("select pg_advisory_xact_lock(20260930, 2)");
      await client.query(INGESTION_SCHEMA_SQL);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally { client.release(); }
  }

  private async ensureWallet(client: pg.PoolClient, wallet: string): Promise<void> {
    const existing = await client.query("select 1 from sat_ingestion_wallets where wallet = $1", [wallet]);
    if (existing.rowCount) return;
    const count = await client.query("select count(*)::int as n from sat_ingestion_wallets");
    if (Number(count.rows[0]?.n) >= this.maxWallets) throw new IngestionStoreError("INGESTION_WALLET_CAPACITY");
    await client.query("insert into sat_ingestion_wallets (wallet, state, version) values ($1, $2::jsonb, 0)", [wallet, INITIAL]);
  }

  private async beginMutation(client: pg.PoolClient): Promise<void> {
    await client.query("begin");
    await client.query("set local lock_timeout = '5s'");
    await client.query("set local statement_timeout = '15s'");
    // One capacity lock gives all processes a consistent count before admitting data.
    await client.query("select pg_advisory_xact_lock(20260930, 3)");
  }

  /** A session lock spans RPC reads, checkpoint writes, and alert dispatch. */
  async withWalletOwner<T>(wallet: string, work: () => Promise<T>): Promise<{ owned: true; value: T } | { owned: false }> {
    SolanaAddressSchema.parse(wallet);
    await this.ensure();
    const client = await this.pool.connect();
    const lockId = createHash("sha256").update(`sentinel-monitor-owner:${wallet}`).digest().readBigInt64BE(0).toString();
    let owned = false;
    try {
      const result = await client.query("select pg_try_advisory_lock($1::bigint) as owned", [lockId]);
      owned = result.rows[0]?.owned === true;
      if (!owned) return { owned: false };
      return { owned: true, value: await work() };
    } finally {
      if (owned) {
        try { await client.query("select pg_advisory_unlock($1::bigint)", [lockId]); }
        catch { /* A disconnected session releases its lock at PostgreSQL. */ }
      }
      client.release();
    }
  }

  async getCheckpoint(wallet: string): Promise<IngestionCheckpoint> {
    SolanaAddressSchema.parse(wallet);
    await this.ensure();
    const client = await this.pool.connect();
    try {
      await this.beginMutation(client);
      await this.ensureWallet(client, wallet);
      const row = await client.query("select state, version from sat_ingestion_wallets where wallet = $1 for update", [wallet]);
      const checkpoint = { ...row.rows[0]?.state, version: Number(row.rows[0]?.version) } as IngestionCheckpoint;
      await client.query("commit");
      return checkpoint;
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally { client.release(); }
  }

  async commitPage(
    wallet: string,
    expectedVersion: number,
    rows: ChainObservation[],
    next: Omit<IngestionCheckpoint, "version">,
  ): Promise<{ checkpoint: IngestionCheckpoint; inserted: number; duplicates: number }> {
    SolanaAddressSchema.parse(wallet);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || expectedVersion >= 2_147_483_647) {
      throw new IngestionStoreError("INGESTION_INVALID_VERSION");
    }
    const page = parseRows(wallet, rows);
    const state = parseNext(next);
    await this.ensure();
    const client = await this.pool.connect();
    try {
      await this.beginMutation(client);
      await this.ensureWallet(client, wallet);
      const locked = await client.query("select version from sat_ingestion_wallets where wallet = $1 for update", [wallet]);
      if (Number(locked.rows[0]?.version) !== expectedVersion) throw new IngestionStoreError("INGESTION_CHECKPOINT_CONFLICT");
      const capacity = await client.query("select count(*)::int as n from sat_chain_observations");
      let count = Number(capacity.rows[0]?.n);
      const outboxCapacity = await client.query("select count(*)::int as n from sat_trade_alert_outbox");
      let outboxCount = Number(outboxCapacity.rows[0]?.n);
      let inserted = 0;
      let duplicates = 0;
      for (const row of page) {
        const hash = digest(row);
        const old = await client.query(`select hash, payload, null::bytea as payload_gzip from sat_chain_observations where wallet = $1 and signature = $2
          union all select hash, null::jsonb as payload, payload_gzip from sat_chain_archive where wallet = $1 and signature = $2`, [wallet, row.signature]);
        if (old.rowCount) {
          const prior = (old.rows[0]?.payload ?? JSON.parse(gunzipSync(old.rows[0]?.payload_gzip as Buffer).toString("utf8"))) as ChainObservation;
          // Parser revisions may change the derived classification, never the source facts.
          if (canonical(prior.raw) !== canonical(row.raw) || prior.slot !== row.slot || prior.blockTime !== row.blockTime) {
            throw new IngestionStoreError("INGESTION_OBSERVATION_CONFLICT");
          }
          duplicates += 1;
          continue;
        } else {
          if (count >= this.maxObservations) throw new IngestionStoreError("INGESTION_OBSERVATION_CAPACITY");
          await client.query(
            "insert into sat_chain_observations (wallet, signature, slot, hash, payload) values ($1, $2, $3, $4, $5::jsonb)",
            [wallet, row.signature, row.slot, hash, row],
          );
          count += 1;
          inserted += 1;
        }
        for (const trade of row.trades) {
          const existing = await client.query("select payload from sat_chain_trades where wallet = $1 and signature = $2", [wallet, trade.signature]);
          if (existing.rowCount) {
            if (canonical(existing.rows[0]?.payload) !== canonical(trade)) throw new IngestionStoreError("INGESTION_TRADE_CONFLICT");
          } else {
            await client.query("insert into sat_chain_trades (wallet, signature, payload) values ($1, $2, $3::jsonb)", [wallet, trade.signature, trade]);
          }
          if (row.outcome === "CLASSIFIED" && (trade.side === "BUY" || trade.side === "SELL") && !trade.isDemo) {
            const pending = await client.query("select payload from sat_trade_alert_outbox where wallet = $1 and signature = $2", [wallet, trade.signature]);
            if (pending.rowCount) {
              if (canonical(pending.rows[0]?.payload) !== canonical(trade)) throw new IngestionStoreError("INGESTION_TRADE_CONFLICT");
            } else if (!existing.rowCount) {
              if (outboxCount >= this.maxOutbox) throw new IngestionStoreError("INGESTION_ALERT_OUTBOX_CAPACITY");
              await client.query("insert into sat_trade_alert_outbox (wallet, signature, payload) values ($1, $2, $3::jsonb)", [wallet, trade.signature, trade]);
              outboxCount += 1;
            }
          }
        }
      }
      const version = expectedVersion + 1;
      await client.query("update sat_ingestion_wallets set state = $1::jsonb, version = $2 where wallet = $3", [state, version, wallet]);
      await client.query("commit");
      return { checkpoint: { ...state, version }, inserted, duplicates };
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally { client.release(); }
  }

  async getTrades(wallet: string, limit = 1000): Promise<WalletTrade[]> {
    SolanaAddressSchema.parse(wallet);
    bounded(limit, 1000, 10_000);
    await this.ensure();
    const rows = await this.pool.query(
      "select payload from sat_chain_trades where wallet = $1 order by payload->>'timestamp' desc, signature desc limit $2",
      [wallet, limit],
    );
    return rows.rows.reverse().map((row) => WalletTradeSchema.parse(row.payload));
  }

  /** Raw observations remain immutable; a parser upgrade writes a separate revision. */
  async recordInterpretation(revision: InterpretationRevision): Promise<"inserted" | "duplicate"> {
    SolanaAddressSchema.parse(revision.wallet);
    if (!validSignature(revision.signature) || !Number.isSafeInteger(revision.version) || revision.version < 1 ||
      !["CLASSIFIED", "UNKNOWN", "FAILED"].includes(revision.outcome) ||
      typeof revision.reason !== "string" || revision.reason.length > 512) throw new IngestionStoreError("INGESTION_INVALID_INTERPRETATION");
    const trades = revision.trades.map((trade) => {
      const parsed = WalletTradeSchema.safeParse(trade);
      if (!parsed.success || parsed.data.sourceSignature !== revision.signature) throw new IngestionStoreError("INGESTION_INVALID_INTERPRETATION");
      return parsed.data;
    });
    const normalized = { ...revision, trades };
    if (Buffer.byteLength(canonical(normalized)) > 1024 * 1024) throw new IngestionStoreError("INGESTION_INTERPRETATION_TOO_LARGE");
    await this.ensure();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const known = await client.query(`select 1 from sat_chain_observations where wallet = $1 and signature = $2
        union all select 1 from sat_chain_archive where wallet = $1 and signature = $2`, [revision.wallet, revision.signature]);
      if (!known.rowCount) throw new IngestionStoreError("INGESTION_OBSERVATION_NOT_FOUND");
      const saved = await client.query(`insert into sat_chain_interpretations (wallet, signature, parser_version, payload)
        values ($1, $2, $3, $4::jsonb) on conflict do nothing returning payload`,
      [revision.wallet, revision.signature, revision.version, normalized]);
      if (!saved.rowCount) {
        const prior = await client.query(`select payload from sat_chain_interpretations
          where wallet = $1 and signature = $2 and parser_version = $3`,
        [revision.wallet, revision.signature, revision.version]);
        if (canonical(prior.rows[0]?.payload) !== canonical(normalized)) throw new IngestionStoreError("INGESTION_INTERPRETATION_CONFLICT");
      }
      await client.query("commit");
      return saved.rowCount ? "inserted" : "duplicate";
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }

  async getRawObservations(wallet: string, limit = 100, before?: { slot: number; signature: string }): Promise<StoredObservation[]> {
    SolanaAddressSchema.parse(wallet);
    bounded(limit, 100, 1000);
    if (before && (!Number.isSafeInteger(before.slot) || before.slot < 0 || !validSignature(before.signature))) {
      throw new IngestionStoreError("INGESTION_INVALID_CURSOR");
    }
    await this.ensure();
    const rows = await this.pool.query(`select wallet, signature, slot, payload::text as payload, null::bytea as payload_gzip
      from sat_chain_observations where wallet = $1 and ($3::bigint is null or (slot, signature) < ($3, $4))
      union all select wallet, signature, slot, null::text as payload, payload_gzip
      from sat_chain_archive where wallet = $1 and ($3::bigint is null or (slot, signature) < ($3, $4))
      order by slot desc, signature desc limit $2`, [wallet, limit, before?.slot ?? null, before?.signature ?? null]);
    return rows.rows.map((row) => {
      const payload = JSON.parse(row.payload ?? gunzipSync(row.payload_gzip as Buffer).toString("utf8")) as ChainObservation;
      return { wallet: row.wallet as string, signature: row.signature as string, slot: Number(row.slot), raw: payload.raw };
    });
  }

  async getActivity(wallet: string, limit = 50): Promise<Array<{ signature: string; slot: number; blockTime: number | null; outcome: string; reason: string; trades: WalletTrade[]; parserVersion: number }>> {
    const raw = await this.getRawObservations(wallet, limit);
    const result = [];
    for (const row of raw) {
      const saved = await this.pool.query(`select payload, null::bytea as compressed from sat_chain_observations where wallet=$1 and signature=$2
        union all select null::jsonb as payload,payload_gzip as compressed from sat_chain_archive where wallet=$1 and signature=$2`, [wallet,row.signature]);
      const record = saved.rows[0];
      if (!record) continue;
      const original = (record.payload ?? JSON.parse(gunzipSync(record.compressed as Buffer).toString("utf8"))) as ChainObservation;
      const revision = await this.pool.query("select payload,parser_version from sat_chain_interpretations where wallet=$1 and signature=$2 order by parser_version desc limit 1", [wallet,row.signature]);
      const derived = revision.rows[0]?.payload ?? original;
      result.push({ signature: row.signature, slot: row.slot, blockTime: original.blockTime,
        outcome: String(derived.outcome), reason: String(derived.reason), trades: derived.trades as WalletTrade[], parserVersion: Number(revision.rows[0]?.parser_version ?? 1) });
    }
    return result;
  }

  /** Move acknowledged old observations out of the hot table while preserving raw evidence and replay keys. */
  async archiveObservations(options: { olderThan: Date; limit?: number }): Promise<number> {
    const limit = bounded(options.limit, 100, 1000);
    if (!(options.olderThan instanceof Date) || !Number.isFinite(options.olderThan.getTime())) throw new IngestionStoreError("INGESTION_INVALID_RETENTION");
    await this.ensure();
    const client = await this.pool.connect();
    try {
      await this.beginMutation(client);
      const rows = await client.query(`select o.wallet, o.signature, o.slot, o.hash, o.payload
        from sat_chain_observations o
        join sat_ingestion_wallets w on w.wallet = o.wallet
        where coalesce(to_timestamp((o.payload->>'blockTime')::bigint), o.ingested_at) < $1
          and o.signature is distinct from w.state->>'anchor'
          and o.signature is distinct from w.state->>'target'
          and o.signature is distinct from w.state->>'before'
          and not exists (select 1 from sat_trade_alert_outbox q where q.wallet = o.wallet and q.signature = o.signature)
        order by o.slot, o.signature limit $2 for update of o skip locked`, [options.olderThan, limit]);
      for (const row of rows.rows) {
        const bytes = gzipSync(Buffer.from(canonical(row.payload)));
        await client.query(`insert into sat_chain_archive (wallet, signature, slot, hash, payload_gzip)
          values ($1, $2, $3, $4, $5)`, [row.wallet, row.signature, row.slot, row.hash, bytes]);
        await client.query("delete from sat_chain_observations where wallet = $1 and signature = $2", [row.wallet, row.signature]);
      }
      await client.query("commit");
      return rows.rowCount ?? 0;
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }

  async getPendingTradeAlerts(wallet: string, limit = 100): Promise<PendingTradeAlert[]> {
    SolanaAddressSchema.parse(wallet);
    bounded(limit, 100, 1000);
    await this.ensure();
    const rows = await this.pool.query(
      "select wallet, signature, payload from sat_trade_alert_outbox where wallet = $1 order by created_at, signature limit $2",
      [wallet, limit],
    );
    return rows.rows.map((row) => ({ wallet: row.wallet as string, signature: row.signature as string,
      trade: WalletTradeSchema.parse(row.payload) }));
  }

  async ackTradeAlert(wallet: string, signature: string): Promise<void> {
    SolanaAddressSchema.parse(wallet);
    if (typeof signature !== "string" || signature.length < 1 || signature.length > 128) throw new IngestionStoreError("INGESTION_INVALID_TRADE");
    await this.ensure();
    await this.pool.query("delete from sat_trade_alert_outbox where wallet = $1 and signature = $2", [wallet, signature]);
  }

  async getCheckpoints(): Promise<Array<{ wallet: string; checkpoint: IngestionCheckpoint }>> {
    await this.ensure();
    const rows = await this.pool.query("select wallet, state, version from sat_ingestion_wallets order by wallet limit 200");
    return rows.rows.map((row) => ({ wallet: row.wallet as string,
      checkpoint: { ...row.state, version: Number(row.version) } as IngestionCheckpoint }));
  }

  async getStats(): Promise<IngestionStats> {
    await this.ensure();
    const client = await this.pool.connect();
    try {
      await client.query("begin isolation level repeatable read read only");
      await client.query("set local statement_timeout = '15s'");
      const counts = await client.query(`select
        (select count(*)::int from sat_ingestion_wallets) as wallets,
        (select count(*)::int from sat_chain_observations) as observations,
        (select count(*)::int from sat_chain_archive) as archived_observations,
        (select count(*)::int from sat_chain_trades) as trades,
        (select count(*)::int from sat_trade_alert_outbox) as pending_alerts`);
      const outcomes = await client.query("select payload->>'outcome' as outcome, count(*)::int as n from sat_chain_observations group by outcome");
      const coverage = await client.query("select state->>'coverage' as coverage, count(*)::int as n from sat_ingestion_wallets group by coverage");
      const stats: IngestionStats = {
        wallets: Number(counts.rows[0]?.wallets), observations: Number(counts.rows[0]?.observations),
        trades: Number(counts.rows[0]?.trades), pendingAlerts: Number(counts.rows[0]?.pending_alerts),
        archivedObservations: Number(counts.rows[0]?.archived_observations),
        observationCapacityPercent: Math.round(100 * Number(counts.rows[0]?.observations) / this.maxObservations),
        outboxCapacityPercent: Math.round(100 * Number(counts.rows[0]?.pending_alerts) / this.maxOutbox),
        outcomes: { CLASSIFIED: 0, UNKNOWN: 0, FAILED: 0 },
        coverage: { BOOTSTRAP_WINDOW: 0, CATCHING_UP: 0, CURRENT: 0 },
      };
      for (const row of outcomes.rows) {
        if (row.outcome in stats.outcomes) stats.outcomes[row.outcome as ChainObservation["outcome"]] = Number(row.n);
      }
      for (const row of coverage.rows) {
        if (row.coverage in stats.coverage) stats.coverage[row.coverage as IngestionCheckpoint["coverage"]] = Number(row.n);
      }
      await client.query("commit");
      return stats;
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally { client.release(); }
  }

  async close(): Promise<void> { await this.pool.end(); }
}
