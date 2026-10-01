import { describe, expect, it, vi } from "vitest";
import { DEFAULT_STRATEGY_LAB_CONFIG, getDemoCandidates, WalletFlowEvidenceSchema, type WalletFlowEvidence } from "@sat/shared";
import { listDemoWalletScores, DEMO_WALLETS } from "@sat/wallet-intel";
import { buildSentinelSignals } from "@sat/signals";
import { runBacktest } from "@sat/backtest";
import { InMemoryDatabase } from "@sat/database";
import { analyzeWallet, listWalletIntelligence, runStrategyLab } from "@sat/pipeline";
import { resetProvidersForTests } from "@sat/pipeline";

const asOf = "2026-09-30T12:00:00.000Z";
const asset = getDemoCandidates().find((x) => x.symbol === "JUP")!;
const wallets = listDemoWalletScores().map((w) => ({ ...w, assessedAt: "2026-09-30T11:59:00.000Z" }));
const marketSignals = [
  { name: "momentum" as const, value: 1, normalizedScore: 0.5, confidence: 0.8, source: "fixture", timestamp: asOf },
  { name: "volume" as const, value: 1, normalizedScore: 0.4, confidence: 0.8, source: "fixture", timestamp: asOf },
];
const buy = (wallet: string, mint = asset.mint, signature = "buy-1", timestamp = "2026-09-30T11:00:00.000Z"): WalletFlowEvidence => ({
  wallet, mint, signature, timestamp, side: "BUY", qty: 10, provider: "fixture",
  freshness: "DEMO", isDemo: true,
});
const build = (evidence: WalletFlowEvidence[]) => buildSentinelSignals({
  asset, marketSignals, wallets, walletFlowEvidence: evidence,
  tokenRiskTier: "LOWER_RISK", tokenRiskScore: 20, asOf,
});

describe("asset-specific signal provenance", () => {
  it("requires an observed same-mint buy and preserves signature and provider", () => {
    expect(build([])).toEqual([]);
    expect(build([buy(DEMO_WALLETS.SMART_B, getDemoCandidates()[1]!.mint)])).toEqual([]);
    const signals = build([buy(DEMO_WALLETS.SMART_B)]);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals[0]!.walletFlowEvidence[0]).toMatchObject({ signature: "buy-1", provider: "fixture", mint: asset.mint });
  });

  it("rejects future, stale, malformed, and mixed-mode evidence", () => {
    expect(build([buy(DEMO_WALLETS.SMART_B, asset.mint, "future", "2026-09-30T12:01:00.000Z")])).toEqual([]);
    expect(build([buy(DEMO_WALLETS.SMART_B, asset.mint, "old", "2026-09-28T12:00:00.000Z")])).toEqual([]);
    expect(build([{ ...buy(DEMO_WALLETS.SMART_B), qty: 0 }])).toEqual([]);
    expect(build([{ ...buy(DEMO_WALLETS.SMART_B), isDemo: false, freshness: "FRESH" }])).toEqual([]);
  });

  it("rejects synthetic leg IDs as live transaction signatures", () => {
    expect(WalletFlowEvidenceSchema.safeParse({
      ...buy(DEMO_WALLETS.SMART_B), isDemo: false, freshness: "FRESH", signature: "a".repeat(64),
    }).success).toBe(false);
    expect(WalletFlowEvidenceSchema.safeParse({
      ...buy(DEMO_WALLETS.SMART_B), isDemo: false, freshness: "FRESH", signature: "1".repeat(63) + "2",
    }).success).toBe(true);
  });

  it("deduplicates signatures and counts distinct wallet groups conservatively", () => {
    const a = buy(DEMO_WALLETS.SMART_B);
    const b = buy(DEMO_WALLETS.SMART_A, asset.mint, "buy-2");
    expect(build([a, a]).some((s) => s.signalType === "MULTI_WALLET_ENTRY")).toBe(false);
    expect(build([a, { ...b, signature: a.signature }]).some((s) => s.signalType === "MULTI_WALLET_ENTRY")).toBe(false);
    expect(build([a, b]).some((s) => s.signalType === "MULTI_WALLET_ENTRY")).toBe(true);
    const grouped = buildSentinelSignals({
      asset, marketSignals, wallets, walletFlowEvidence: [a, b],
      walletClusters: [{ id: "cluster", wallets: [a.wallet, b.wallet], labels: ["RELATED_ACTIVITY"], confidence: 0.5, evidence: [], isDemo: true, ownershipClaimed: false }],
      tokenRiskTier: "LOWER_RISK", tokenRiskScore: 20, asOf,
    });
    expect(grouped.some((s) => s.signalType === "MULTI_WALLET_ENTRY")).toBe(false);
  });
});

describe("Strategy Lab evidence boundaries", () => {
  const bars = Array.from({ length: 40 }, (_, i) => ({
    timestamp: Date.parse("2026-09-29T00:00:00.000Z") + i * 3_600_000,
    open: 10 + i * 0.1, high: 10.2 + i * 0.1, low: 9.9 + i * 0.1,
    close: 10.1 + i * 0.1, volume: 1000 + i * 10,
  }));
  const config = { ...DEFAULT_STRATEGY_LAB_CONFIG, momentumThreshold: -1, volumeThreshold: -1, maxVolatility: 10 };
  it("does not turn supplied summary counts into live historical wallet evidence", () => {
    const result = runBacktest({
      markets: [{ mint: asset.mint, bars, liquidityUsd: 1_000_000, tokenAgeHours: 100,
        tokenRiskScore: 20, confirmingWallets: 3, walletCredibility: 90 }],
      config, isDemo: false,
    });
    expect(result.trades).toEqual([]);
    expect(result.benchmarkEquity).toEqual([]);
    expect(result.warnings.join(" ")).toContain("WALLET_EVIDENCE_UNAVAILABLE");
    expect(result.warnings.join(" ")).toContain("BENCHMARK_UNAVAILABLE");
  });

  it("does not backdate a current risk snapshot even when historical flow exists", () => {
    const walletScores = wallets.filter((w) => w.address === DEMO_WALLETS.SMART_A || w.address === DEMO_WALLETS.SMART_B)
      .map((w) => ({ ...w, isDemo: false, dataFreshness: "FRESH" as const, assessedAt: new Date(bars[0]!.timestamp).toISOString() }));
    const walletFlowEvidence = walletScores.map((w, i) => ({
      ...buy(w.address, asset.mint, "1".repeat(63) + (i === 0 ? "2" : "3"), new Date(bars[1]!.timestamp).toISOString()),
      isDemo: false, freshness: "FRESH" as const,
    }));
    const result = runBacktest({
      markets: [{ mint: asset.mint, bars, liquidityUsd: 1_000_000, tokenAgeHours: 100,
        tokenRiskScore: 20, walletScores, walletFlowEvidence }], config, isDemo: false,
    });
    expect(result.trades).toEqual([]);
    expect(result.warnings.join(" ")).toContain("RISK_INPUTS_UNAVAILABLE");
  });

  it("does not count known related wallets as two live confirmations", () => {
    const walletScores = wallets.filter((w) => w.address === DEMO_WALLETS.SMART_A || w.address === DEMO_WALLETS.SMART_B)
      .map((w) => ({ ...w, isDemo: false, dataFreshness: "FRESH" as const, assessedAt: new Date(bars[0]!.timestamp).toISOString() }));
    const walletFlowEvidence = walletScores.map((w, i) => ({
      ...buy(w.address, asset.mint, "1".repeat(63) + (i === 0 ? "2" : "3"), new Date(bars[1]!.timestamp).toISOString()),
      isDemo: false, freshness: "FRESH" as const,
    }));
    const base = {
      mint: asset.mint, bars, walletScores, walletFlowEvidence,
      riskByTimestamp: bars.map((bar) => ({
        timestamp: bar.timestamp, liquidityUsd: 1_000_000, tokenAgeHours: 100, tokenRiskScore: 20,
      })),
    };
    const separate = runBacktest({ markets: [base], config, isDemo: false });
    expect(separate.trades.some((t) => t.side === "BUY")).toBe(true);
    const related = runBacktest({
      markets: [{ ...base, walletClusters: [{ id: "related", wallets: walletScores.map((w) => w.address),
        labels: ["RELATED_ACTIVITY"], confidence: 0.5, evidence: [], isDemo: false, ownershipClaimed: false }] }],
      config, isDemo: false,
    });
    expect(related.trades).toEqual([]);
  });

  it("fails closed on unknown risk and invalid bars", () => {
    const noRisk = runBacktest({
      markets: [{ mint: asset.mint, bars, liquidityUsd: 1_000_000, tokenAgeHours: 100,
        confirmingWallets: 3, walletCredibility: 90 }], config, isDemo: true,
    });
    expect(noRisk.trades).toEqual([]);
    expect(noRisk.warnings.join(" ")).toContain("RISK_INPUTS_UNAVAILABLE");
    const invalid = runBacktest({ markets: [{ mint: asset.mint, bars: [...bars, bars[0]!] }], isDemo: false });
    expect(invalid.trades).toEqual([]);
    expect(invalid.warnings.join(" ")).toContain("INVALID_HISTORY");
  });

  it("returns insufficient history without inventing bars or benchmark", () => {
    const result = runBacktest({ markets: [{ mint: asset.mint, bars: [] }], isDemo: false });
    expect(result.dataCoverage.bars).toBe(0);
    expect(result.benchmarkEquity).toEqual([]);
    expect(result.metrics).toBeNull();
  });

  it("does not synthesize missing live bars in the Strategy Lab pipeline", async () => {
    const oldKey = process.env.BIRDEYE_API_KEY;
    process.env.BIRDEYE_API_KEY = "test-key";
    resetProvidersForTests();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("provider unavailable"); }));
    try {
      const db = new InMemoryDatabase();
      await db.setCandidates([{ ...asset, isDemo: false }]);
      const result = await runStrategyLab({ mint: asset.mint, db });
      expect(result.dataCoverage.bars).toBe(0);
      expect(result.trades).toEqual([]);
      expect(result.isDemo).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      if (oldKey === undefined) delete process.env.BIRDEYE_API_KEY;
      else process.env.BIRDEYE_API_KEY = oldKey;
      resetProvidersForTests();
    }
  });

  it("does not return or persist demo wallet scores in live-only state", async () => {
    const db = new InMemoryDatabase();
    await db.setCandidates([{ ...asset, isDemo: false }]);
    expect(await listWalletIntelligence(db)).toEqual([]);
    await expect(analyzeWallet(DEMO_WALLETS.SMART_B, db)).rejects.toThrow("LIVE_WALLET_HISTORY_UNAVAILABLE");
    expect((await db.getState()).walletScores).toEqual([]);
  });
});
