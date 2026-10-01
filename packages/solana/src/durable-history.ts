import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { SolanaAddressSchema, WalletTradeSchema } from "@sat/shared";
import type { WalletHistoryProvider, WalletHistoryResult } from "./history-types";
import { dedupeTrades } from "./normalize";

const resultSchema = z.object({
  address: SolanaAddressSchema,
  trades: z.array(WalletTradeSchema),
  freshness: z.enum(["FRESH", "STALE", "INSUFFICIENT", "DEMO"]),
  provenance: z.array(z.string().max(512)).max(100),
  isDemo: z.boolean(),
  provider: z.string().max(200),
  diagnostics: z.object({
    status: z.enum(["COMPLETE", "PARTIAL", "FAILED", "INVALID"]),
    pages: z.number().int().nonnegative(), received: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(), duplicates: z.number().int().nonnegative(),
    retries: z.number().int().nonnegative(), reason: z.string().max(512).optional(),
    failedTransactions: z.number().int().nonnegative().optional(),
    unknownEvents: z.number().int().nonnegative().optional(),
  }).optional(),
});
const snapshotSchema = z.object({
  version: z.literal(1),
  result: resultSchema,
  completedAt: z.string().datetime().nullable(),
  savedAt: z.string().datetime(),
  tradeHighWater: z.object({ signature: z.string(), timestamp: z.string().datetime() }).nullable(),
});
type Snapshot = z.infer<typeof snapshotSchema>;

export class HistoryStoreError extends Error {
  constructor(readonly code: string) { super(code); this.name = "HistoryStoreError"; }
}

export interface DurableHistoryOptions {
  maxTrades?: number;
  maxWallets?: number;
  maxPending?: number;
  maxBytes?: number;
  shutdownMs?: number;
  /** Fault-injection hook, immediately before the atomic rename. */
  beforeRename?: () => Promise<void>;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function bounded(value: number | undefined, fallback: number, ceiling: number): number {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < 1 || n > ceiling) throw new HistoryStoreError("invalid-history-limit");
  return n;
}

/**
 * Single-writer, opt-in local history archive. Published results and observation
 * checkpoints share one fsync + rename boundary. No queue/outbox/live stream is
 * claimed. Reads always refresh; an outage returns explicitly stale saved data.
 */
export class DurableWalletHistoryProvider implements WalletHistoryProvider {
  readonly name: string;
  readonly isDemo: boolean;
  private readonly directory: string;
  private readonly limits: Required<Omit<DurableHistoryOptions, "beforeRename">>;
  private readonly controller = new AbortController();
  private readonly pending = new Map<string, Promise<WalletHistoryResult>>();
  private init: Promise<void> | null = null;
  private lockOwned = false;
  private closing = false;
  private closeTask: Promise<void> | null = null;
  private activeWallets = new Set<string>();
  private reservedWallets = new Set<string>();

  constructor(private readonly upstream: WalletHistoryProvider, directory: string, private readonly options: DurableHistoryOptions = {}) {
    this.name = `durable-${upstream.name}`;
    this.isDemo = upstream.isDemo;
    this.directory = resolve(directory);
    this.limits = {
      maxTrades: bounded(options.maxTrades, 10_000, 100_000),
      maxWallets: bounded(options.maxWallets, 200, 10_000),
      maxPending: bounded(options.maxPending, 32, 1_000),
      maxBytes: bounded(options.maxBytes, 32 * 1024 * 1024, 128 * 1024 * 1024),
      shutdownMs: bounded(options.shutdownMs, 15_000, 60_000),
    };
  }

  private async initialize(): Promise<void> {
    const { readdir } = await import("node:fs/promises");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lock = await open(join(this.directory, ".writer.lock"), "wx", 0o600).catch(() => { throw new HistoryStoreError("history-store-locked"); });
    this.lockOwned = true;
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid }));
      await lock.sync();
      for (const file of await readdir(this.directory)) {
        if (file.endsWith(".json")) {
          const address = file.slice(0, -5);
          if (!SolanaAddressSchema.safeParse(address).success) throw new HistoryStoreError("history-store-invalid-file");
          this.activeWallets.add(address);
        }
        // A crash before rename leaves an unpublished temporary file. Once the
        // writer lock is acquired no writer can own it, so it is safe to discard.
        if (/^\.history-[0-9a-f-]+\.tmp$/.test(file)) await unlink(join(this.directory, file));
      }
      if (this.activeWallets.size > this.limits.maxWallets) throw new HistoryStoreError("history-wallet-capacity");
    } catch (error) {
      await this.releaseLock();
      throw error;
    } finally { await lock.close(); }
  }

  private async read(address: string): Promise<Snapshot | null> {
    const file = await open(join(this.directory, `${address}.json`), "r").catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null;
      throw new HistoryStoreError("history-store-read-failed");
    });
    if (!file) return null;
    try {
      if ((await file.stat()).size > this.limits.maxBytes) throw new HistoryStoreError("history-store-too-large");
      const bytes = await file.readFile();
      if (bytes.length > this.limits.maxBytes) throw new HistoryStoreError("history-store-too-large");
      const envelope = JSON.parse(bytes.toString("utf8")) as { data: unknown; sha256: unknown };
      if (digest(envelope.data) !== envelope.sha256) throw new HistoryStoreError("history-store-checksum");
      const data = snapshotSchema.parse(envelope.data);
      if (data.result.address !== address || data.result.trades.length > this.limits.maxTrades) throw new HistoryStoreError("history-store-invalid-snapshot");
      return data;
    } catch (err) {
      if (err instanceof HistoryStoreError) throw err;
      throw new HistoryStoreError("history-store-corrupt");
    } finally { await file.close(); }
  }

  private async publish(address: string, data: Snapshot): Promise<void> {
    const temp = join(this.directory, `.history-${randomUUID()}.tmp`);
    const bytes = Buffer.from(JSON.stringify({ data, sha256: digest(data) }));
    if (bytes.length > this.limits.maxBytes) throw new HistoryStoreError("history-store-too-large");
    const file = await open(temp, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
      await file.close();
      await this.options.beforeRename?.();
      await rename(temp, join(this.directory, `${address}.json`));
      this.activeWallets.add(address);
      const dir = await open(this.directory, "r");
      try { await dir.sync(); } finally { await dir.close(); }
    } catch {
      // A post-rename fsync failure is an uncertain commit. Do not report success;
      // replay is idempotent and the next read verifies the published checksum.
      throw new HistoryStoreError("history-store-write-failed");
    } finally {
      await file.close().catch(() => undefined);
      await unlink(temp).catch((err: NodeJS.ErrnoException) => { if (err.code !== "ENOENT") throw new HistoryStoreError("history-temp-cleanup-failed"); });
    }
  }

  getTrades(address: string, options: { signal?: AbortSignal } = {}): Promise<WalletHistoryResult> {
    if (this.closing) return Promise.reject(new HistoryStoreError("history-provider-closing"));
    if (options.signal?.aborted) return Promise.reject(new HistoryStoreError("history-request-aborted"));
    if (!SolanaAddressSchema.safeParse(address).success) return Promise.reject(new HistoryStoreError("invalid-wallet-address"));
    // Signal-bearing calls do not share cancellation with another caller.
    const key = options.signal ? `${address}:${randomUUID()}` : address;
    const existing = this.pending.get(key);
    if (existing) return existing.then((value) => structuredClone(value));
    if (this.pending.size >= this.limits.maxPending) return Promise.reject(new HistoryStoreError("history-pending-capacity"));
    // Prevent same-wallet write races even when callers have distinct signals.
    if ([...this.pending.keys()].some((k) => k === address || k.startsWith(`${address}:`))) {
      return Promise.reject(new HistoryStoreError("history-wallet-busy"));
    }
    const task = this.refresh(address, options.signal).finally(() => { this.pending.delete(key); });
    this.pending.set(key, task);
    return task.then((value) => structuredClone(value));
  }

  private async refresh(address: string, signal?: AbortSignal): Promise<WalletHistoryResult> {
    if (!this.init) this.init = this.initialize();
    await this.init;
    if (!this.activeWallets.has(address)) {
      if (this.activeWallets.size + this.reservedWallets.size >= this.limits.maxWallets) throw new HistoryStoreError("history-wallet-capacity");
      this.reservedWallets.add(address);
    }
    try { return await this.refreshStored(address, signal); }
    finally { this.reservedWallets.delete(address); }
  }

  private async refreshStored(address: string, signal?: AbortSignal): Promise<WalletHistoryResult> {
    const previous = await this.read(address);
    const combined = signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal;
    const fetched = await this.upstream.getTrades(address, { signal: combined });
    if (combined.aborted) throw new HistoryStoreError("history-request-aborted");
    const valid = resultSchema.safeParse(fetched);
    if (!valid.success || fetched.address !== address) throw new HistoryStoreError("invalid-history-result");
    if (previous && previous.result.isDemo !== fetched.isDemo) throw new HistoryStoreError("history-provenance-change");
    if (fetched.diagnostics?.status === "FAILED" || fetched.diagnostics?.status === "INVALID" || (!fetched.trades.length && fetched.freshness === "INSUFFICIENT" && fetched.diagnostics?.status !== "COMPLETE")) {
      if (!previous) return fetched;
      return { ...previous.result, freshness: "STALE", provenance: ["durable-snapshot-stale", `savedAt=${previous.savedAt}`, ...previous.result.provenance, ...fetched.provenance].slice(0, 100), diagnostics: fetched.diagnostics };
    }
    const merged = dedupeTrades([...(previous?.result.trades ?? []), ...fetched.trades]);
    if (merged.conflicts) throw new HistoryStoreError("history-conflicting-signature");
    const groups = (rows: WalletHistoryResult["trades"]) => {
      const grouped = new Map<string, string[]>();
      for (const trade of rows) {
        const key = trade.sourceSignature ?? trade.signature;
        const facts = JSON.stringify([trade.mint, trade.side, trade.qty, trade.timestamp, trade.priceUsd, trade.usdNotional]);
        grouped.set(key, [...(grouped.get(key) ?? []), facts]);
      }
      return new Map([...grouped].map(([key, facts]) => [key, JSON.stringify([...new Set(facts)].sort())]));
    };
    const archived = groups(previous?.result.trades ?? []);
    for (const [signature, facts] of groups(fetched.trades)) {
      if (archived.has(signature) && archived.get(signature) !== facts) throw new HistoryStoreError("history-conflicting-signature");
    }
    if (merged.trades.length > this.limits.maxTrades) throw new HistoryStoreError("history-trade-capacity");
    const trades = merged.trades.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.signature.localeCompare(b.signature));
    const complete = fetched.diagnostics?.status === "COMPLETE";
    const now = new Date().toISOString();
    const result: WalletHistoryResult = {
      ...fetched, trades,
      freshness: complete && fetched.trades.length ? fetched.freshness : trades.length ? "STALE" : "INSUFFICIENT",
      provenance: [...fetched.provenance, "durable-history-archive", `archive-duplicates-suppressed=${merged.duplicates}`],
    };
    const newest = trades.at(-1);
    await this.publish(address, {
      version: 1, result: resultSchema.parse(result), savedAt: now,
      completedAt: complete ? now : previous?.completedAt ?? null,
      tradeHighWater: complete && newest ? { signature: newest.sourceSignature ?? newest.signature, timestamp: newest.timestamp } : previous?.tradeHighWater ?? null,
    });
    return result;
  }

  async checkpoint(address: string): Promise<Pick<Snapshot, "completedAt" | "savedAt" | "tradeHighWater"> | null> {
    if (!SolanaAddressSchema.safeParse(address).success) throw new HistoryStoreError("invalid-wallet-address");
    if (this.closing) throw new HistoryStoreError("history-provider-closing");
    if (!this.init) this.init = this.initialize();
    await this.init;
    const snapshot = await this.read(address);
    return snapshot && { completedAt: snapshot.completedAt, savedAt: snapshot.savedAt, tradeHighWater: snapshot.tradeHighWater };
  }

  private async releaseLock(): Promise<void> {
    if (this.lockOwned) { await unlink(join(this.directory, ".writer.lock")); this.lockOwned = false; }
  }

  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.closing = true;
    this.controller.abort();
    this.closeTask = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const drain = Promise.allSettled([...this.pending.values()]).then(async () => {
        await this.init?.catch(() => undefined);
        await this.releaseLock();
      });
      try {
        await Promise.race([drain, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new HistoryStoreError("history-shutdown-timeout")), this.limits.shutdownMs);
        })]);
      } finally { if (timer) clearTimeout(timer); }
    })();
    return this.closeTask;
  }
}
