import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JUP, USDC } from "@sat/shared";
import { DEMO_WALLETS } from "@sat/wallet-intel";
import { DurableWalletHistoryProvider, parseHeliusEnhancedTx, type WalletHistoryResult, type WalletHistoryProvider } from "@sat/solana";

const W = DEMO_WALLETS.SMART_A;
const OTHER = DEMO_WALLETS.SMART_B;
const dirs: string[] = [];
const providers: DurableWalletHistoryProvider[] = [];
async function directory() { const dir = await mkdtemp(join(tmpdir(), "sentinel-history-")); dirs.push(dir); return dir; }
function trades(sig = "synthetic", timestamp = 1_700_000_000) {
  return parseHeliusEnhancedTx(W, { signature: sig, timestamp, type: "SWAP", events: { swap: {
    tokenInputs: [{ userAccount: W, mint: USDC, tokenAmount: 1 }],
    tokenOutputs: [{ userAccount: W, mint: JUP, tokenAmount: 2 }],
  } } });
}
function history(xs = trades(), status: "COMPLETE" | "PARTIAL" | "FAILED" = "COMPLETE"): WalletHistoryResult {
  return { address: W, trades: xs, freshness: status === "COMPLETE" ? "FRESH" : xs.length ? "STALE" : "INSUFFICIENT", isDemo: false,
    provider: "synthetic-offline", provenance: ["synthetic-offline"],
    diagnostics: { status, pages: 1, received: xs.length, rejected: 0, duplicates: 0, retries: 0 } };
}
function upstream(get: WalletHistoryProvider["getTrades"]): WalletHistoryProvider {
  return { name: "synthetic-offline", isDemo: false, getTrades: get };
}
function provider(dir: string, source: WalletHistoryProvider, options = {}) {
  const p = new DurableWalletHistoryProvider(source, dir, options); providers.push(p); return p;
}
afterEach(async () => { await Promise.allSettled(providers.splice(0).map((p) => p.close())); await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

describe("durable wallet-history observation snapshots", () => {
  it("a failed new-wallet fetch releases its capacity reservation", async () => {
    const p = provider(await directory(), upstream(async (address) => address === W ? history([], "FAILED") : { ...history(), address: OTHER }), { maxWallets: 1 });
    await p.getTrades(W);
    expect((await p.getTrades(OTHER)).address).toBe(OTHER);
  });
  it("a complete empty refresh retains explicitly stale archive provenance", async () => {
    let result = history();
    const p = provider(await directory(), upstream(async () => result));
    await p.getTrades(W);
    result = { ...history([]), freshness: "INSUFFICIENT" };
    expect(await p.getTrades(W)).toMatchObject({ freshness: "STALE", trades: trades() });
  });
  it("malformed completion diagnostics cannot authorize a checkpoint", async () => {
    const result = history();
    result.diagnostics!.pages = NaN;
    const p = provider(await directory(), upstream(async () => result));
    await expect(p.getTrades(W)).rejects.toThrow("invalid-history-result");
    expect(await p.checkpoint(W)).toBeNull();
  });
  it("restart and duplicate replay preserve one leg and the checkpoint", async () => {
    const dir = await directory();
    const first = provider(dir, upstream(async () => history()));
    await first.getTrades(W);
    const checkpoint = await first.checkpoint(W);
    await first.close();
    const reopened = provider(dir, upstream(async () => history()));
    expect((await reopened.getTrades(W)).trades).toHaveLength(1);
    expect((await reopened.checkpoint(W))?.tradeHighWater).toEqual(checkpoint?.tradeHighWater);
    expect((await readdir(dir)).filter((f) => f.endsWith(".json"))).toHaveLength(1);
  });
  it("partial progress is durable but never advances the completed high-water mark", async () => {
    const dir = await directory();
    let result = history();
    const p = provider(dir, upstream(async () => result));
    await p.getTrades(W);
    const before = await p.checkpoint(W);
    result = history(trades("new", 1_700_000_001), "PARTIAL");
    expect((await p.getTrades(W)).trades).toHaveLength(2);
    const partial = await p.checkpoint(W);
    expect(partial?.completedAt).toBe(before?.completedAt);
    expect(partial?.tradeHighWater).toEqual(before?.tradeHighWater);
    await p.close();
    const restarted = provider(dir, upstream(async () => history([], "FAILED")));
    const saved = await restarted.getTrades(W);
    expect(saved.trades).toHaveLength(2);
    expect(saved.freshness).toBe("STALE");
    expect(saved.diagnostics?.status).toBe("FAILED");
  });
  it("out-of-order overlapping refreshes merge deterministically without duplicating effects", async () => {
    const dir = await directory();
    let result = history(trades("late", 1_700_000_010));
    const p = provider(dir, upstream(async () => result));
    await p.getTrades(W);
    result = history([...trades("late", 1_700_000_010), ...trades("early", 1_700_000_000)]);
    const merged = await p.getTrades(W);
    expect(merged.trades.map((t) => t.sourceSignature)).toEqual(["early", "late"]);
  });
  it("concurrent duplicate refreshes coalesce and return defensive copies", async () => {
    let calls = 0;
    const p = provider(await directory(), upstream(async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return history(); }));
    const [a, b] = await Promise.all([p.getTrades(W), p.getTrades(W)]);
    expect(calls).toBe(1);
    a.trades[0]!.qty = 999;
    expect(b.trades[0]!.qty).toBe(2);
  });
  it("interrupted write preserves the prior committed snapshot and permits replay", async () => {
    let fail = false;
    let result = history();
    const dir = await directory();
    const p = provider(dir, upstream(async () => result), { beforeRename: async () => { if (fail) throw new Error("synthetic-write-failure"); } });
    await p.getTrades(W);
    const before = await readFile(join(dir, `${W}.json`), "utf8");
    result = history(trades("new", 1_700_000_001));
    fail = true;
    await expect(p.getTrades(W)).rejects.toThrow("history-store-write-failed");
    expect(await readFile(join(dir, `${W}.json`), "utf8")).toBe(before);
    expect((await readdir(dir)).some((f) => f.endsWith(".tmp"))).toBe(false);
    fail = false;
    expect((await p.getTrades(W)).trades).toHaveLength(2);
  });
  it("corrupt or truncated durable state fails closed and is preserved for inspection", async () => {
    const dir = await directory();
    const p = provider(dir, upstream(async () => history()));
    await p.getTrades(W);
    await writeFile(join(dir, `${W}.json`), "{truncated");
    await expect(p.getTrades(W)).rejects.toThrow("history-store-corrupt");
    expect(await readFile(join(dir, `${W}.json`), "utf8")).toBe("{truncated");
  });
  it("conflicting duplicate evidence does not overwrite committed history", async () => {
    const dir = await directory();
    let result = history();
    const p = provider(dir, upstream(async () => result));
    await p.getTrades(W);
    const before = await readFile(join(dir, `${W}.json`), "utf8");
    result = history([{ ...trades()[0]!, qty: 3 }]);
    await expect(p.getTrades(W)).rejects.toThrow("history-conflicting-signature");
    expect(await readFile(join(dir, `${W}.json`), "utf8")).toBe(before);
  });
  it.each(["side", "mint"])("a changed %s across replays cannot create contradictory transaction legs", async (field) => {
    let result = history();
    const p = provider(await directory(), upstream(async () => result));
    await p.getTrades(W);
    result = history([{ ...trades()[0]!, ...(field === "side" ? { side: "SELL" as const } : { mint: USDC }) }]);
    await expect(p.getTrades(W)).rejects.toThrow("history-conflicting-signature");
  });
  it("retention capacity rejects explicitly instead of silently evicting known evidence", async () => {
    const dir = await directory();
    let result = history();
    const p = provider(dir, upstream(async () => result), { maxTrades: 1 });
    await p.getTrades(W);
    result = history(trades("new", 1_700_000_001));
    await expect(p.getTrades(W)).rejects.toThrow("history-trade-capacity");
    expect((await p.checkpoint(W))?.tradeHighWater?.signature).toBe("synthetic");
  });
  it("second writers fail explicitly; clean shutdown releases the writer lock", async () => {
    const dir = await directory();
    const first = provider(dir, upstream(async () => history()));
    await first.getTrades(W);
    const second = provider(dir, upstream(async () => history()));
    await expect(second.getTrades(W)).rejects.toThrow("history-store-locked");
    await first.close();
    const next = provider(dir, upstream(async () => history()));
    expect((await next.getTrades(W)).trades).toHaveLength(1);
  });
  it("shutdown aborts in-flight requests, rejects new work and permits controlled restart", async () => {
    const dir = await directory();
    let started!: () => void;
    const ready = new Promise<void>((r) => { started = r; });
    const p = provider(dir, upstream((_address, opts) => new Promise((_resolve, reject) => {
      started(); opts!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })));
    const inflight = p.getTrades(W).catch((err: Error) => err);
    await ready;
    await p.close();
    expect(await inflight).toBeInstanceOf(Error);
    await expect(p.getTrades(W)).rejects.toThrow("history-provider-closing");
    const next = provider(dir, upstream(async () => history()));
    expect((await next.getTrades(W)).trades).toHaveLength(1);
  });
  it("bounds pending distinct-wallet work and does not accept path traversal", async () => {
    let release!: (r: WalletHistoryResult) => void;
    const p = provider(await directory(), upstream(() => new Promise((r) => { release = r; })), { maxPending: 1 });
    const one = p.getTrades(W);
    await expect(p.getTrades(OTHER)).rejects.toThrow("history-pending-capacity");
    await expect(p.getTrades("../bad")).rejects.toThrow("invalid-wallet-address");
    while (!release) await new Promise((r) => setTimeout(r, 1));
    release(history()); await one;
  });
});
