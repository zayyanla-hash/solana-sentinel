import { describe, expect, it } from "vitest";
import { detectWalletMigrations } from "../packages/wallet-migration/src/index";
import type { WalletTrade } from "@sat/shared";

const W1 = "11111111111111111111111111111111";
const W2 = "So11111111111111111111111111111111111111112";
const W3 = "Vote111111111111111111111111111111111111111";
const W4 = "Stake11111111111111111111111111111111111111";
const MINT_A = "EPjFWdd5AufqSSqeM2q8s8F6e3mZ9Z6jF4nZ4eF8qH8";
const MINT_B = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const asOf = "2025-01-02T00:00:00.000Z";

function trade(signature: string, wallet: string, side: "SELL" | "BUY", mint: string, timestamp: string, extra: Partial<WalletTrade> = {}): { wallet: string; trade: WalletTrade } {
  return {
    wallet,
    trade: {
      signature, timestamp, mint, side, usdNotional: 100, qty: 10, priceUsd: 10,
      tokenAgeHoursAtEntry: null, liquidityUsdAtEntry: null, slippageBps: null,
      counterparty: null, isDemo: false, ...extra,
    },
  };
}

function run(records: Array<{ wallet: string; trade: WalletTrade }>, extra: Record<string, unknown> = {}) {
  const tradesByWallet: Record<string, WalletTrade[]> = {};
  for (const record of records) (tradesByWallet[record.wallet] ??= []).push(record.trade);
  return detectWalletMigrations({ tradesByWallet, asOf, ...extra });
}

function transition(wallet = W1, prefix = "tx", sellAt = "2025-01-01T10:00:00.000Z", buyAt = "2025-01-01T11:00:00.000Z") {
  return [
    trade(`${prefix}-sell`, wallet, "SELL", MINT_A, sellAt),
    trade(`${prefix}-buy`, wallet, "BUY", MINT_B, buyAt),
  ];
}

describe("wallet migration intelligence", () => {
  it("aggregates independent wallets into one deterministic A-to-B signal", () => {
    const records = [...transition(W1, "one"), ...transition(W2, "two")];
    const first = run(records);
    const second = run([...records].reverse());
    expect(first.migrations).toHaveLength(1);
    expect(first.migrations[0]).toMatchObject({ sourceMint: MINT_A, destinationMint: MINT_B, transitionCount: 2, uniqueWalletCount: 2, valuationQuality: "COMPLETE", estimatedMigratedNotionalUsd: 200, migrationVelocityWalletsPerHour: 2 / 720, firstTransitionAt: "2025-01-01T11:00:00.000Z", lastTransitionAt: "2025-01-01T11:00:00.000Z", ownershipClaimed: false });
    expect(first.migrations[0]?.evidence.map(({ signature }) => signature)).toEqual(["one-sell", "one-buy", "two-sell", "two-buy"]);
    expect(first.migrations[0]?.id).toBe(second.migrations[0]?.id);
  });

  it("uses the latest BUY completion even when SELL order differs", () => {
    const result = run([
      ...transition(W1, "slow", "2025-01-01T10:00:00.000Z", "2025-01-01T15:00:00.000Z"),
      ...transition(W2, "fast", "2025-01-01T11:00:00.000Z", "2025-01-01T12:00:00.000Z"),
    ]);
    expect(result.migrations[0]?.firstTransitionAt).toBe("2025-01-01T12:00:00.000Z");
    expect(result.migrations[0]?.lastTransitionAt).toBe("2025-01-01T15:00:00.000Z");
  });

  it("orders equivalent UTC timestamp spellings by instant", () => {
    const result = run([
      trade("atomic", W1, "SELL", MINT_A, "2025-01-01T10:00:00Z"),
      trade("atomic", W1, "BUY", MINT_B, "2025-01-01T10:00:00Z"),
      trade("later-sell", W2, "SELL", MINT_A, "2025-01-01T10:00:00Z"),
      trade("later-buy", W2, "BUY", MINT_B, "2025-01-01T10:00:00.999Z"),
    ]);
    expect(result.migrations[0]?.firstTransitionAt).toBe("2025-01-01T10:00:00Z");
    expect(result.migrations[0]?.lastTransitionAt).toBe("2025-01-01T10:00:00.999Z");
  });

  it("counts a wallet once despite repeat transitions and removes duplicate signatures", () => {
    const records = [
      ...transition(W1, "first"),
      ...transition(W1, "second", "2025-01-01T12:00:00.000Z", "2025-01-01T13:00:00.000Z"),
      ...transition(W2, "third"),
    ];
    const result = run([...records, ...records]);
    expect(result.migrations[0]).toMatchObject({ transitionCount: 3, uniqueWalletCount: 2, repeatPenalty: 0.15 });
  });

  it("requires SELL(A) before BUY(B) within maxDelayHours", () => {
    const reversed = [trade("buy-first", W1, "BUY", MINT_B, "2025-01-01T09:00:00.000Z"), trade("sell-later", W1, "SELL", MINT_A, "2025-01-01T10:00:00.000Z")];
    const delayed = transition(W2, "late", "2025-01-01T08:00:00.000Z", "2025-01-01T20:00:00.000Z");
    expect(run([...reversed, ...delayed], { maxDelayHours: 6 }).migrations).toHaveLength(0);
  });

  it("excludes stale and future data relative to the causal asOf window", () => {
    const stale = transition(W1, "stale", "2024-12-01T08:00:00.000Z", "2024-12-01T09:00:00.000Z");
    const future = transition(W2, "future", "2025-01-02T01:00:00.000Z", "2025-01-02T02:00:00.000Z");
    expect(run([...stale, ...future], { windowHours: 72 }).migrations).toHaveLength(0);
  });

  it("counts distinct migrating wallets and weights members of a cluster", () => {
    const records = [...transition(W1, "a"), ...transition(W2, "b"), ...transition(W3, "c")];
    const cluster = { id: "cluster-1", wallets: [W1, W2, W4], labels: ["POSSIBLE_CLUSTER"], confidence: 0.4, evidence: ["graph edge"], isDemo: false, ownershipClaimed: false as const };
    const result = run(records, { clusters: [cluster] });
    expect(result.migrations[0]).toMatchObject({ uniqueWalletCount: 3, uniqueClusterCount: 1, clusterAdjustedCount: 2 });
  });

  it("reports missing or partial observed valuation without imputing prices", () => {
    const noPrices = transition().map(({ wallet, trade: t }) => ({ wallet, trade: { ...t, usdNotional: 0, priceUsd: null } }));
    expect(run(noPrices).migrations[0]).toMatchObject({ valuationQuality: "MISSING", estimatedMigratedNotionalUsd: null });
    const partial = transition().map(({ wallet, trade: t }, i) => ({ wallet, trade: { ...t, usdNotional: i === 0 ? 100 : 0, priceUsd: null } }));
    expect(run(partial).migrations[0]).toMatchObject({ valuationQuality: "PARTIAL", estimatedMigratedNotionalUsd: null });
  });

  it("sums the lower observed leg per transition as migrated capital", () => {
    const records = [
      ...transition(W1, "asym1").map(({ wallet, trade: t }, i) => ({ wallet, trade: { ...t, usdNotional: i === 0 ? 150 : 75 } })),
      ...transition(W2, "asym2").map(({ wallet, trade: t }, i) => ({ wallet, trade: { ...t, usdNotional: i === 0 ? 50 : 125 } })),
    ];
    expect(run(records).migrations[0]?.estimatedMigratedNotionalUsd).toBe(125);
  });

  it("allows an atomic same-signature swap but not equal-time legs from different signatures", () => {
    const atomic = [trade("atomic", W1, "SELL", MINT_A, "2025-01-01T10:00:00.000Z"), trade("atomic", W1, "BUY", MINT_B, "2025-01-01T10:00:00.000Z")];
    const unrelated = [trade("sell", W2, "SELL", MINT_A, "2025-01-01T10:00:00.000Z"), trade("buy", W2, "BUY", MINT_B, "2025-01-01T10:00:00.000Z")];
    const result = run([...atomic, ...unrelated]);
    expect(result.migrations).toHaveLength(1);
    expect(result.migrations[0]?.uniqueWalletCount).toBe(1);
    expect(result.migrations[0]?.evidence.map((entry) => entry.signature)).toEqual(["atomic", "atomic"]);
  });

  it("pairs side-specific normalized signatures with a shared source transaction signature", () => {
    const timestamp = "2025-01-01T10:00:00.000Z";
    const normalized = [
      trade("chain-sig:SELL:EPjFWdd5", W1, "SELL", MINT_A, timestamp, { sourceSignature: "chain-sig" }),
      trade("chain-sig:BUY:TokenkegQ", W1, "BUY", MINT_B, timestamp, { sourceSignature: "chain-sig" }),
    ];
    expect(run(normalized).migrations[0]).toMatchObject({ transitionCount: 1, firstTransitionAt: timestamp, lastTransitionAt: timestamp });
  });

  it("reserves atomic pairs before an earlier unrelated SELL can consume the BUY", () => {
    const timestamp = "2025-01-01T10:00:00.000Z";
    const records = [
      trade("unrelated-sell", W1, "SELL", MINT_A, "2025-01-01T09:00:00.000Z"),
      trade("atomic-sell", W1, "SELL", MINT_A, timestamp, { sourceSignature: "atomic-source" }),
      trade("atomic-buy", W1, "BUY", MINT_B, timestamp, { sourceSignature: "atomic-source" }),
    ];
    const migration = run(records).migrations[0];
    expect(migration).toMatchObject({ transitionCount: 1, firstTransitionAt: timestamp, lastTransitionAt: timestamp });
    expect(migration?.evidence.map((item) => item.signature)).toEqual(["atomic-sell", "atomic-buy"]);
  });

  it("deduplicates on on-chain signature even when source signature metadata differs", () => {
    const records = transition(W1, "dedupe");
    const duplicated = records.map(({ wallet, trade: t }) => ({ wallet, trade: { ...t, sourceSignature: "different-metadata" } }));
    expect(run([...records, ...duplicated]).migrations[0]).toMatchObject({ transitionCount: 1, uniqueWalletCount: 1 });
  });

  it("allows source-signature-only duplicate enrichment", () => {
    const records = transition(W1, "enrich");
    const enriched = records.map(({ wallet, trade: t }) => ({ wallet, trade: { ...t, sourceSignature: `source-${t.signature}` } }));
    const migration = run([...records, ...enriched]).migrations[0];
    expect(migration?.transitionCount).toBe(1);
    expect(migration?.evidence.map((item) => item.sourceSignature)).toEqual(["source-enrich-sell", "source-enrich-buy"]);
  });

  it("fails closed on conflicting duplicate trade payloads", () => {
    const records = transition(W1, "conflict");
    const conflicting = records.map(({ wallet, trade: t }) => ({ wallet, trade: { ...t, qty: t.qty + 1 } }));
    expect(() => run([...records, ...conflicting])).toThrow(/Conflicting duplicate wallet trade/);
  });

  it("rejects overlapping supplied wallet clusters", () => {
    const clusters = [
      { id: "cluster-a", wallets: [W1, W2], labels: ["POSSIBLE_CLUSTER"], confidence: 0.4, evidence: [], isDemo: false, ownershipClaimed: false as const },
      { id: "cluster-b", wallets: [W2, W3], labels: ["RELATED_ACTIVITY"], confidence: 0.4, evidence: [], isDemo: false, ownershipClaimed: false as const },
    ];
    expect(() => run(transition(W1), { clusters })).toThrow(/overlapping clusters/);
  });

  it("preserves tiny and extreme observed values without producing a credibility score", () => {
    const tiny = transition().map(({ wallet, trade: t }) => ({ wallet, trade: { ...t, qty: 0.000001, usdNotional: 0.00001 } }));
    expect(run(tiny).migrations[0]?.estimatedMigratedNotionalUsd).toBe(0.00001);
    const extreme = transition().map(({ wallet, trade: t }) => ({ wallet, trade: { ...t, usdNotional: 1_000_000_000 } }));
    expect(run(extreme).migrations[0]?.estimatedMigratedNotionalUsd).toBe(1_000_000_000);
    expect(run(extreme).migrations[0]).not.toHaveProperty("credibility");
  });

  it("derives a value only from sourced, historical prices within the configured age", () => {
    const [sell, buy] = transition();
    const validPrice = { usdNotional: 0, priceUsd: 10, priceSource: "historical-oracle", priceAsOf: "2025-01-01T09:30:00.000Z" };
    const bothValid = [
      { ...sell!, trade: { ...sell!.trade, ...validPrice } },
      { ...buy!, trade: { ...buy!.trade, ...validPrice } },
    ];
    expect(run(bothValid).migrations[0]).toMatchObject({ valuationQuality: "COMPLETE", estimatedMigratedNotionalUsd: 100 });

    const future = bothValid.map(({ wallet, trade: t }) => ({ wallet, trade: { ...t, priceAsOf: "2025-01-01T12:00:00.000Z" } }));
    expect(run(future).migrations[0]).toMatchObject({ valuationQuality: "MISSING", estimatedMigratedNotionalUsd: null });
    const stale = bothValid.map(({ wallet, trade: t }) => ({ wallet, trade: { ...t, priceAsOf: "2024-12-30T00:00:00.000Z" } }));
    expect(run(stale).migrations[0]).toMatchObject({ valuationQuality: "MISSING", estimatedMigratedNotionalUsd: null });
    const noProvenance = bothValid.map(({ wallet, trade: t }) => ({ wallet, trade: { ...t, priceSource: null } }));
    expect(run(noProvenance).migrations[0]).toMatchObject({ valuationQuality: "MISSING", estimatedMigratedNotionalUsd: null });
  });

  it("rejects a positive notional when its attached price timestamp is in the future", () => {
    const future = transition().map(({ wallet, trade: t }) => ({ wallet, trade: { ...t, priceAsOf: "2025-01-01T12:00:00.000Z" } }));
    expect(run(future).migrations[0]).toMatchObject({ valuationQuality: "MISSING", estimatedMigratedNotionalUsd: null });
  });

  it("rejects corrupt runtime input", () => {
    expect(() => detectWalletMigrations({ tradesByWallet: { [W1]: [{ signature: "bad", side: "SELL" }] }, asOf })).toThrow();
  });
});
