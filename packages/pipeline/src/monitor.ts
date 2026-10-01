import { createHash } from "node:crypto";
import { AlertEventSchema, SolanaAddressSchema, type AlertRule, type WalletTrade } from "@sat/shared";
import { IngestionStoreError, type ChainObservation, type IngestionCheckpoint, type PostgresIngestionStore, type Database } from "@sat/database";
import { interpretRpcTransaction, boundedInteger, SafeHttpError, type SignatureRow } from "@sat/solana";
import { scoreWallet } from "@sat/wallet-intel";

export interface MonitorReader {
  verifyMainnet(signal?: AbortSignal): Promise<void>;
  signatures(wallet: string, before: string | null, limit: number, signal?: AbortSignal): Promise<SignatureRow[]>;
  transaction(signature: string, signal?: AbortSignal): Promise<Record<string, unknown>>;
}
export interface PollResult {
  wallet: string;
  ok: boolean;
  coverage: IngestionCheckpoint["coverage"] | "UNAVAILABLE";
  inserted: number;
  duplicates: number;
  pages: number;
  reason: string | null;
  checkpoint: IngestionCheckpoint | null;
}
type Store = Pick<PostgresIngestionStore, "getCheckpoint" | "commitPage">;

function tradeEventId(wallet: string, signature: string, ruleId: string): string {
  const bytes = createHash("sha256").update(JSON.stringify(["live-trade-alert-v1", wallet, signature, ruleId])).digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function quietNow(rule: AlertRule, now: Date): boolean {
  if (!rule.quietHoursUtc) return false;
  const [start, end] = rule.quietHoursUtc;
  const hour = now.getUTCHours();
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

function matchesTrade(rule: AlertRule, wallet: string, trade: WalletTrade, now: Date): boolean {
  if (!rule.enabled || rule.isDemo || trade.isDemo || !["BUY", "SELL"].includes(trade.side)) return false;
  if (rule.trigger !== `TRACKED_WALLET_${trade.side}` || (rule.wallet && rule.wallet !== wallet) ||
    (rule.mint && rule.mint !== trade.mint)) return false;
  const tradeAt = Date.parse(trade.timestamp);
  if (!Number.isFinite(tradeAt) || tradeAt < Date.parse(rule.createdAt) || tradeAt > now.getTime()) return false;
  return rule.threshold == null || trade.usdNotional >= rule.threshold;
}

/** The outbox is acknowledged only after every matching rule has a durable event fact. */
export async function dispatchPendingTradeAlerts(
  wallet: string,
  store: Pick<PostgresIngestionStore, "getPendingTradeAlerts" | "ackTradeAlert">,
  db: Pick<Database, "getState" | "recordAlertEvent">,
  options: { limit?: number; clock?: () => Date } = {},
): Promise<{ processed: number; events: number; remaining: boolean }> {
  SolanaAddressSchema.parse(wallet);
  const limit = boundedInteger(options.limit, 100, 1, 1000);
  const pending = await store.getPendingTradeAlerts(wallet, limit);
  let events = 0;
  for (const item of pending) {
    if (item.wallet !== wallet || item.trade.signature !== item.signature) throw new Error("alert-outbox-identity-mismatch");
    // Rules are evaluated at dispatch time. A rule created after the trade cannot
    // turn a historical bootstrap observation into a newly delivered alert.
    const state = await db.getState();
    const now = options.clock?.() ?? new Date();
    for (const rule of state.alertRules.filter((r) => matchesTrade(r, wallet, item.trade, now))) {
      const quiet = quietNow(rule, now);
      const internal = rule.channel === "INTERNAL";
      const delivered = internal && !quiet;
      const event = AlertEventSchema.parse({
        id: tradeEventId(wallet, item.signature, rule.id), ruleId: rule.id, trigger: rule.trigger,
        channel: rule.channel,
        title: `Tracked wallet ${item.trade.side.toLowerCase()} observed`,
        body: `${wallet} ${item.trade.side.toLowerCase()} ${item.trade.qty} of ${item.trade.mint} in a finalized transaction.`,
        payload: { wallet, mint: item.trade.mint, side: item.trade.side, qty: item.trade.qty,
          usdNotional: item.trade.usdNotional, tradeSignature: item.signature,
          sourceSignature: item.trade.sourceSignature ?? null, tradeAt: item.trade.timestamp,
          observedAt: now.toISOString(),
          classificationConfidence: item.trade.classificationConfidence ?? null,
          provider: item.trade.provider ?? null },
        delivered, suppressedReason: quiet ? "quiet hours" : internal ? null : `${rule.channel} provider not configured`,
        createdAt: now.toISOString(), isDemo: false,
      });
      const expiresAt = new Date(now.getTime() + rule.cooldownMinutes * 60_000).toISOString();
      await db.recordAlertEvent(event, delivered && rule.cooldownMinutes > 0
        ? { key: `${rule.id}:${item.trade.mint}:${wallet}`, expiresAt } : undefined);
      events++;
    }
    await store.ackTradeAlert(wallet, item.signature);
  }
  return { processed: pending.length, events, remaining: pending.length === limit };
}

function safeFailure(error: unknown): string {
  if (error instanceof IngestionStoreError) return error.code;
  if (error instanceof SafeHttpError) return error.kind === "http" ? `http-${error.status}` : error.kind;
  if (error instanceof Error && /^rpc-[a-z-]+$/.test(error.message)) return error.message;
  return "monitor-operation-failed";
}
function nextState(cp: IngestionCheckpoint): Omit<IngestionCheckpoint, "version"> {
  const { version: _version, ...state } = cp;
  return state;
}

export async function persistMonitorScore(wallet: string, result: PollResult, store: Pick<PostgresIngestionStore, "getTrades">, db: Database): Promise<void> {
  const trades = await store.getTrades(wallet);
  const age = result.checkpoint?.lastSuccessAt ? Date.now() - Date.parse(result.checkpoint.lastSuccessAt) : Infinity;
  await db.upsertWalletScore(scoreWallet({ address: wallet, trades, isDemo: false,
    dataFreshness: result.ok && result.coverage === "CURRENT" && age >= 0 && age <= 120_000
      ? "FRESH" : trades.length ? "STALE" : "INSUFFICIENT" }));
}

/** Recoverable bounded polling. CURRENT means caught up to the saved bootstrap boundary,
 * never complete lifetime wallet/token-account history. No checkpoint advances on uncertainty. */
export class PollingMonitor {
  private verified = false;
  private active = new Set<string>();
  private readonly pageSize: number;
  private readonly maxPages: number;
  private readonly clock: () => Date;
  constructor(private readonly reader: MonitorReader, private readonly store: Store,
    options: { pageSize?: number; maxPagesPerCycle?: number; clock?: () => Date } = {}) {
    this.pageSize = boundedInteger(options.pageSize, 10, 1, 100);
    this.maxPages = boundedInteger(options.maxPagesPerCycle, 2, 1, 100);
    this.clock = options.clock ?? (() => new Date());
  }
  async pollWallet(wallet: string, signal?: AbortSignal): Promise<PollResult> {
    SolanaAddressSchema.parse(wallet);
    if (this.active.has(wallet) || this.active.size >= 32) throw new Error("monitor-admission-saturated");
    this.active.add(wallet);
    let cp: IngestionCheckpoint | null = null;
    let inserted = 0, duplicates = 0, pages = 0;
    try {
      cp = await this.store.getCheckpoint(wallet);
      if (!this.verified) { await this.reader.verifyMainnet(signal); this.verified = true; }
      const initialWindow = cp.anchor == null && cp.target == null && cp.lastSuccessAt == null;
      const cursorSeen = new Set<string>();
      for (let pageIndex = 0; pageIndex < this.maxPages; pageIndex++) {
        if (signal?.aborted) throw new Error("rpc-aborted");
        const rows = await this.reader.signatures(wallet, cp.before, this.pageSize, signal);
        const headObservedAt = this.clock().toISOString();
        pages++;
        const anchorIndex = cp.anchor ? rows.findIndex((row) => row.signature === cp!.anchor) : -1;
        const selected = anchorIndex >= 0 ? rows.slice(0, anchorIndex) : rows;
        const observations: ChainObservation[] = [];
        for (const row of selected) {
          if (signal?.aborted) throw new Error("rpc-aborted");
          const raw = await this.reader.transaction(row.signature, signal);
          const interpretation = interpretRpcTransaction(row.signature, wallet, raw);
          if (interpretation.slot !== row.slot || (row.blockTime != null && interpretation.blockTime !== row.blockTime) ||
            (row.err != null) !== (interpretation.outcome === "FAILED")) throw new Error("rpc-history-transaction-mismatch");
          observations.push({ wallet, signature: row.signature, raw, ...interpretation });
        }
        const target = cp.target ?? rows[0]?.signature ?? cp.anchor;
        const targetObservedAt = cp.target ? cp.targetObservedAt ?? null : rows.length ? headObservedAt : null;
        const reachedEnd = rows.length < this.pageSize;
        // First run explicitly adopts a recent window; empty history on a prior successful
        // run is instead traversed until its end so bursts after an empty start are recovered.
        const complete = initialWindow || anchorIndex >= 0 || (cp.anchor == null && reachedEnd);
        if (!complete && reachedEnd) throw new Error("rpc-history-gap");
        const last = rows.at(-1)?.signature ?? null;
        if (!complete && (!last || last === cp.before || cursorSeen.has(last))) throw new Error("rpc-pagination-cycle");
        const saved = await this.store.commitPage(wallet, cp.version, observations, {
          ...nextState(cp),
          anchor: complete ? target : cp.anchor,
          target: complete ? null : target,
          targetObservedAt: complete ? null : targetObservedAt,
          before: complete ? null : last,
          coverage: initialWindow ? "BOOTSTRAP_WINDOW" : complete ? "CURRENT" : "CATCHING_UP",
          // A long catch-up cannot make an old head look freshly observed.
          // Legacy pending checkpoints without this field stay conservatively stale.
          lastSuccessAt: complete ? cp.target ? cp.targetObservedAt ?? cp.lastSuccessAt : headObservedAt : cp.lastSuccessAt,
          lastError: null,
        });
        cp = saved.checkpoint;
        inserted += saved.inserted;
        duplicates += saved.duplicates;
        if (complete) break;
        cursorSeen.add(last!);
      }
      return { wallet, ok: cp.coverage !== "CATCHING_UP", coverage: cp.coverage, inserted, duplicates, pages,
        reason: cp.coverage === "CATCHING_UP" ? "catch-up-pending" : null, checkpoint: cp };
    } catch (error) {
      const reason = safeFailure(error);
      if (cp) {
        try { cp = (await this.store.commitPage(wallet, cp.version, [], { ...nextState(cp), lastError: reason })).checkpoint; }
        catch { /* Preserve original failure; storage failure is reported, never acknowledged as progress. */ }
      }
      return { wallet, ok: false, coverage: cp?.coverage ?? "UNAVAILABLE", inserted, duplicates, pages, reason, checkpoint: cp };
    } finally { this.active.delete(wallet); }
  }
}
