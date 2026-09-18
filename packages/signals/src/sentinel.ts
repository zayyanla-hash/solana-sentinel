import {
  type CandidateAsset,
  type SignalResult,
  type WalletCredibilityScore,
  type SentinelSignal,
  SentinelSignalSchema,
  newId,
  nowIso,
} from "@sat/shared";

export function buildSentinelSignals(input: {
  asset: CandidateAsset;
  marketSignals: SignalResult[];
  wallets: WalletCredibilityScore[];
  tokenRiskTier: string;
  tokenRiskScore: number;
}): SentinelSignal[] {
  const { asset, marketSignals, wallets, tokenRiskTier, tokenRiskScore } = input;
  const byName = Object.fromEntries(marketSignals.map((s) => [s.name, s]));
  const mom = byName.momentum?.normalizedScore ?? 0;
  const vol = byName.volume?.normalizedScore ?? 0;
  const liq = byName.liquidity?.normalizedScore ?? 0;
  const credible = wallets.filter((w) => w.score >= 60 && w.confidence >= 0.35 && w.sampleSize >= 5);
  const independent = new Set(credible.map((w) => w.address)).size;
  const out: SentinelSignal[] = [];

  const liquidityRisk =
    (asset.liquidityUsd ?? 0) < 50_000
      ? "HIGH"
      : (asset.liquidityUsd ?? 0) < 250_000
        ? "ELEVATED"
        : "MODERATE";

  const baseProv = [
    `market=${asset.dataSources.join(",") || "unknown"}`,
    `wallets=${wallets.length}`,
    `tokenRisk=${tokenRiskTier}`,
    asset.isDemo ? "DEMO" : "LIVE_OR_PAPER",
  ];

  if (independent >= 2 && mom > 0 && tokenRiskTier !== "HIGH_RISK") {
    const score = Math.min(
      100,
      40 + independent * 8 + mom * 20 + Math.max(0, vol) * 10 - tokenRiskScore * 0.2,
    );
    const confidence = Math.min(
      0.85,
      0.25 + independent * 0.1 + (byName.momentum?.confidence ?? 0) * 0.3,
    );
    out.push(
      SentinelSignalSchema.parse({
        id: newId(),
        asset: asset.mint,
        symbol: asset.symbol,
        timestamp: nowIso(),
        signalType: "MULTI_WALLET_ENTRY",
        score: Number(score.toFixed(1)),
        confidence: Number(confidence.toFixed(3)),
        walletEvidence: credible.slice(0, 5).map(
          (w) => `${w.address.slice(0, 6)}… score ${w.score} conf ${w.confidence} n=${w.sampleSize}`,
        ),
        marketEvidence: [
          `momentum ${mom.toFixed(3)}`,
          `volume ${vol.toFixed(3)}`,
          `liquidity ${liq.toFixed(3)}`,
        ],
        tokenRisk: tokenRiskTier,
        liquidityRisk,
        explanation: [
          `${independent} independent wallets with credibility ≥ 60 accumulated ${asset.symbol}`,
          "Score is not expected profitability — it is evidence strength",
        ],
        invalidationConditions: [
          "Any confirming wallet score drops below 50 on refresh",
          "Token-risk upgrades to HIGH_RISK",
          "Liquidity falls below $50k",
        ],
        provenance: baseProv,
        isDemo: Boolean(asset.isDemo || wallets.some((w) => w.isDemo)),
      }),
    );
  }

  if (credible.length >= 1 && mom > 0.2 && vol > 0.1) {
    const top = [...credible].sort((a, b) => b.score - a.score)[0]!;
    out.push(
      SentinelSignalSchema.parse({
        id: newId(),
        asset: asset.mint,
        symbol: asset.symbol,
        timestamp: nowIso(),
        signalType: "MARKET_CONFIRMED_FLOW",
        score: Number(Math.min(100, 35 + top.score * 0.3 + mom * 25 + vol * 15).toFixed(1)),
        confidence: Number(Math.min(0.8, 0.3 + top.confidence * 0.4).toFixed(3)),
        walletEvidence: [`top wallet ${top.address.slice(0, 6)}… ${top.score}`],
        marketEvidence: [`momentum ${mom.toFixed(3)}`, `volume ${vol.toFixed(3)}`],
        tokenRisk: tokenRiskTier,
        liquidityRisk,
        explanation: [
          "Credible wallet flow coincided with volume/momentum confirmation",
          "Not a guarantee the move continues",
        ],
        invalidationConditions: ["Momentum flips negative on next closed 5m bar"],
        provenance: baseProv,
        isDemo: Boolean(asset.isDemo || top.isDemo),
      }),
    );
  }

  if ((asset.tokenAgeHours ?? 10_000) < 48 && credible.length >= 1) {
    out.push(
      SentinelSignalSchema.parse({
        id: newId(),
        asset: asset.mint,
        symbol: asset.symbol,
        timestamp: nowIso(),
        signalType: "NEW_MARKET_ENTRY",
        score: 42,
        confidence: 0.28,
        walletEvidence: credible.slice(0, 3).map((w) => w.address),
        marketEvidence: [`tokenAgeHours=${asset.tokenAgeHours}`],
        tokenRisk: tokenRiskTier,
        liquidityRisk,
        explanation: ["Credible wallet entered a young market — elevated uncertainty"],
        invalidationConditions: ["No follow-through volume within 4h"],
        provenance: baseProv,
        isDemo: Boolean(asset.isDemo),
      }),
    );
  }

  return out;
}
