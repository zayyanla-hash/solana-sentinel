import {
  type CandidateAsset,
  type SignalResult,
  type WalletCredibilityScore,
  type SentinelSignal,
  SentinelSignalSchema,
  nowIso,
} from "@sat/shared";
import { createHash } from "node:crypto";

function deterministicId(parts: string[]): string {
  const h = createHash("sha256").update(parts.join("|")).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function buildSentinelSignals(input: {
  asset: CandidateAsset;
  marketSignals: SignalResult[];
  wallets: WalletCredibilityScore[];
  tokenRiskTier: string;
  tokenRiskScore: number;
  asOf?: string;
}): SentinelSignal[] {
  const { asset, marketSignals, wallets, tokenRiskTier, tokenRiskScore } = input;
  const asOf = input.asOf ?? nowIso();
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
    ...credible.slice(0, 3).map((w) => `wallet:${w.address}:score=${w.score}:n=${w.sampleSize}`),
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
        id: deterministicId(["MULTI_WALLET_ENTRY", asset.mint, asOf, ...credible.map((w) => w.address).sort()]),
        asset: asset.mint,
        symbol: asset.symbol,
        timestamp: asOf,
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
        id: deterministicId(["MARKET_CONFIRMED_FLOW", asset.mint, asOf, top.address]),
        asset: asset.mint,
        symbol: asset.symbol,
        timestamp: asOf,
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
        id: deterministicId(["NEW_MARKET_ENTRY", asset.mint, asOf, credible[0]!.address]),
        asset: asset.mint,
        symbol: asset.symbol,
        timestamp: asOf,
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
