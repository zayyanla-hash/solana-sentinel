import { describe, it, expect } from "vitest";
import { SolanaAddressSchema, QuoteProviderError, DEFAULT_STRATEGY_LAB_CONFIG } from "@sat/shared";
import {
  scoreWallet,
  analyzeDemoWallet,
  listDemoWalletScores,
  DEMO_WALLETS,
  closeRoundTrips,
  getDemoWalletTrades,
} from "@sat/wallet-intel";
import { buildWalletGraph } from "@sat/wallet-graph";
import { runBacktest, randomEntryControl } from "@sat/backtest";
import { AlertEngine, InternalAlertProvider } from "@sat/alerts";
import { entitlementsFor, parseTier } from "@sat/entitlements";
import { x402Enabled, paymentRequired, verifyPaymentSignature } from "@sat/x402";
import { JupiterSwapV2Provider, JupiterUltraLegacyProvider, createExecutionProvider } from "@sat/execution";
import { buildSentinelSignals } from "@sat/signals";
import { getDemoCandidates, newId } from "@sat/shared";
import { backoffMs, DemoStreamProvider } from "@sat/streaming";
import { rateLimitAllow, resetObservabilityForTests } from "@sat/observability";
import { assessTokenRisk } from "@sat/token-risk";
import { buildDemoOhlcv } from "@sat/market-data";

describe("wallet intelligence", () => {
  it("parses demo wallet addresses", () => {
    for (const addr of Object.values(DEMO_WALLETS)) {
      expect(SolanaAddressSchema.safeParse(addr).success).toBe(true);
    }
  });

  it("does not rank a lucky moonshot above a consistent wallet", () => {
    const scores = Object.fromEntries(listDemoWalletScores().map((s) => [s.address, s]));
    const smart = scores[DEMO_WALLETS.SMART_A]!;
    const lucky = scores[DEMO_WALLETS.LUCKY_MOON]!;
    expect(smart.neverGuaranteed).toBe(true);
    expect(lucky.reasonCodes).toContain("MOONSHOT_CONCENTRATION");
    expect(smart.score).toBeGreaterThan(lucky.score);
    expect(lucky.sampleSize).toBeLessThan(5);
  });

  it("penalizes wash/creator wallets and never claims guarantee", () => {
    const wash = analyzeDemoWallet(DEMO_WALLETS.WASH);
    const dev = analyzeDemoWallet(DEMO_WALLETS.DEV);
    expect(wash.reasonCodes).toContain("WASH_OR_HYPERACTIVE");
    expect(dev.reasonCodes).toContain("CREATOR_OR_DEV");
    expect(dev.neverGuaranteed).toBe(true);
  });

  it("does not treat transfers/airdrops as buys", () => {
    const trades = getDemoWalletTrades()[DEMO_WALLETS.DEV]!;
    expect(closeRoundTrips(trades)).toHaveLength(0);
  });

  it("insufficient history stays low-confidence", () => {
    const s = scoreWallet({
      address: DEMO_WALLETS.SMART_A,
      trades: [],
      isDemo: false,
      dataFreshness: "INSUFFICIENT",
    });
    expect(s.confidence).toBeLessThan(0.4);
    expect(s.reasonCodes).toContain("SMALL_SAMPLE");
  });
});

describe("wallet graph", () => {
  it("labels clusters without claiming ownership", () => {
    const g = buildWalletGraph({ tradesByWallet: getDemoWalletTrades(), isDemo: true });
    for (const c of g.clusters) {
      expect(c.ownershipClaimed).toBe(false);
      expect(c.labels.length).toBeGreaterThan(0);
    }
  });
});

describe("backtest engine", () => {
  it("fills at next bar open, not the signal close", () => {
    const bars = Array.from({ length: 80 }, (_, i) => ({
      timestamp: 1_700_000_000_000 + i * 3_600_000,
      open: 10 + i * 0.2,
      high: 10.4 + i * 0.2,
      low: 9.8 + i * 0.2,
      close: 10.1 + i * 0.2,
      volume: 1000 + i,
    }));
    const result = runBacktest({
      markets: [
        {
          mint: getDemoCandidates()[0]!.mint,
          bars,
          liquidityUsd: 5_000_000,
          tokenAgeHours: 10_000,
          tokenRiskScore: 20,
          confirmingWallets: 3,
          walletCredibility: 80,
        },
      ],
      config: {
        ...DEFAULT_STRATEGY_LAB_CONFIG,
        momentumThreshold: -1,
        volumeThreshold: -1,
        maxVolatility: 10,
        stopLossPct: 0.99,
        takeProfitPct: 0.99,
        maxHoldingBars: 3,
      },
      isDemo: true,
      walkForward: false,
    });
    const buys = result.trades.filter((t) => t.side === "BUY");
    for (const b of buys) {
      const signalBar = bars[b.barIndex - 1];
      if (signalBar) {
        expect(b.price).toBe(bars[b.barIndex]!.open);
        expect(b.price).not.toBe(signalBar.close);
      }
    }
    expect(result.label).toBe("DEMO");
    expect(result.warnings.join(" ")).toMatch(/not live/i);
  });

  it("hides metrics on tiny samples", () => {
    const bars = buildDemoOhlcv({
      mint: getDemoCandidates()[0]!.mint,
      lastClose: 1,
      interval: "1h",
      count: 12,
      endMs: Date.now(),
    });
    const result = runBacktest({
      markets: [{ mint: getDemoCandidates()[0]!.mint, bars }],
      isDemo: true,
    });
    expect(result.metrics).toBeNull();
  });

  it("random-entry control is deterministic for a seed", () => {
    const bars = buildDemoOhlcv({
      mint: getDemoCandidates()[0]!.mint,
      lastClose: 1,
      interval: "1h",
      count: 40,
      endMs: 1_700_000_000_000,
    });
    expect(randomEntryControl(bars, 100_000, 7)).toEqual(randomEntryControl(bars, 100_000, 7));
  });
});

describe("alerts", () => {
  it("dedupes via cooldown and records history", async () => {
    const engine = new AlertEngine([new InternalAlertProvider()], () => new Date("2026-01-01T12:00:00Z"));
    engine.upsertRule({
      id: newId(),
      name: "cross",
      trigger: "SENTINEL_SCORE_CROSS",
      channel: "INTERNAL",
      threshold: 50,
      mint: null,
      wallet: null,
      cooldownMinutes: 60,
      quietHoursUtc: null,
      enabled: true,
      createdAt: new Date().toISOString(),
      isDemo: true,
    });
    const first = await engine.emit({
      trigger: "SENTINEL_SCORE_CROSS",
      title: "cross",
      body: "hit",
      value: 80,
    });
    const second = await engine.emit({
      trigger: "SENTINEL_SCORE_CROSS",
      title: "cross",
      body: "hit",
      value: 80,
    });
    expect(first[0]?.delivered).toBe(true);
    expect(second[0]?.suppressedReason).toBe("cooldown");
  });
});

describe("entitlements and x402", () => {
  it("maps tiers without embedding prices", () => {
    expect(entitlementsFor("FREE").strategyLab).toBe(false);
    expect(entitlementsFor("PRO").strategyLab).toBe(true);
    expect(parseTier("advanced")).toBe("ADVANCED");
  });

  it("x402 is off by default and does not invent payment success", async () => {
    delete process.env.X402_ENABLED;
    expect(x402Enabled()).toBe(false);
    const v = await verifyPaymentSignature("dGVzdA==", "token-risk");
    expect(v.valid).toBe(false);
    process.env.X402_PAY_TO = "";
    const pay = paymentRequired("token-risk", "test");
    expect(pay.status).toBe(402);
    expect(pay.body.error).toMatch(/PAY_TO unset|PAYMENT_REQUIRED/);
  });
});

describe("execution honesty", () => {
  it("createExecutionProvider is demo without a Jupiter key", () => {
    const prev = process.env.JUPITER_API_KEY;
    delete process.env.JUPITER_API_KEY;
    expect(createExecutionProvider().isDemo).toBe(true);
    if (prev) process.env.JUPITER_API_KEY = prev;
  });

  it("swap v2 fails closed on HTTP error", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: false, status: 401 }) as Response) as typeof fetch;
    try {
      await expect(
        new JupiterSwapV2Provider("https://api.jup.ag/swap/v2", "test").quote({
          inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          outputMint: "So11111111111111111111111111111111111111112",
          amount: "1000",
        }),
      ).rejects.toBeInstanceOf(QuoteProviderError);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("legacy Ultra provider refuses deprecated calls", async () => {
    await expect(
      new JupiterUltraLegacyProvider().quote({
        inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        outputMint: "So11111111111111111111111111111111111111112",
        amount: "1000",
      }),
    ).rejects.toBeInstanceOf(QuoteProviderError);
  });
});

describe("sentinel signals", () => {
  it("keeps score and confidence separate", () => {
    const asset = getDemoCandidates().find((c) => c.symbol === "JUP")!;
    const wallets = listDemoWalletScores();
    const signals = buildSentinelSignals({
      asset,
      marketSignals: [
        {
          name: "momentum",
          value: 4,
          normalizedScore: 0.4,
          confidence: 0.8,
          source: "test",
          timestamp: new Date().toISOString(),
        },
        {
          name: "volume",
          value: 3,
          normalizedScore: 0.3,
          confidence: 0.7,
          source: "test",
          timestamp: new Date().toISOString(),
        },
        {
          name: "liquidity",
          value: 1,
          normalizedScore: 0.2,
          confidence: 0.7,
          source: "test",
          timestamp: new Date().toISOString(),
        },
      ],
      wallets,
      tokenRiskTier: "LOWER_RISK",
      tokenRiskScore: 20,
    });
    expect(signals.length).toBeGreaterThan(0);
    for (const s of signals) {
      expect(s.score).not.toBe(s.confidence);
      expect(s.invalidationConditions.length).toBeGreaterThan(0);
    }
  });
});

describe("token-risk v2 unknowns stay null", () => {
  it("does not invent Jupiter organic score", () => {
    const asset = getDemoCandidates().find((c) => c.symbol === "JUP")!;
    const a = assessTokenRisk(asset, {
      tokenProgram: "TOKEN",
      mintAuthority: false,
      freezeAuthority: false,
    });
    expect(a.details.jupiterOrganicScore).toBeNull();
    expect(a.details.jupiterVerified).toBeNull();
    expect(a.details.missingFields).toContain("jupiterOrganicScore");
  });
});

describe("streaming / observability", () => {
  it("backoff grows and stream does not autostart timers", () => {
    expect(backoffMs(0)).toBeLessThan(backoffMs(3));
    const s = new DemoStreamProvider();
    expect(s.health().status).toBe("demo_fallback");
    void s.close();
  });

  it("rate limiter eventually denies", () => {
    resetObservabilityForTests();
    const key = "test-ip";
    let denied = false;
    for (let i = 0; i < 80; i++) {
      if (!rateLimitAllow(key, 5, 0)) denied = true;
    }
    expect(denied).toBe(true);
  });
});
