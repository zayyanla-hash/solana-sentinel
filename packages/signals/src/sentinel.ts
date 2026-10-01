import {
  type CandidateAsset,
  type SignalResult,
  type WalletCredibilityScore,
  type WalletFlowEvidence,
  type WalletCluster,
  type SentinelSignal,
  SentinelSignalSchema,
  WalletFlowEvidenceSchema,
  nowIso,
} from "@sat/shared";
import { createHash } from "node:crypto";

export const FLOW_WINDOW_MS = 24 * 60 * 60 * 1000;

function deterministicId(parts: string[]): string {
  const h = createHash("sha256").update(parts.join("|")).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function eligibleWalletFlow(input: {
  mint: string;
  asOf: string;
  isDemo: boolean;
  evidence: WalletFlowEvidence[];
  wallets: WalletCredibilityScore[];
}): Array<{ flow: WalletFlowEvidence; score: WalletCredibilityScore }> {
  const end = Date.parse(input.asOf);
  if (!Number.isFinite(end)) return [];
  const scores = new Map(input.wallets.filter((w) =>
    w.score >= 60 && w.confidence >= 0.35 && w.sampleSize >= 5 &&
    w.isDemo === input.isDemo &&
    w.dataFreshness === (input.isDemo ? "DEMO" : "FRESH") &&
    Date.parse(w.assessedAt) <= end && end - Date.parse(w.assessedAt) <= FLOW_WINDOW_MS,
  ).map((w) => [w.address, w]));
  const unique = new Map<string, { flow: WalletFlowEvidence; score: WalletCredibilityScore }>();
  for (const raw of input.evidence) {
    const parsed = WalletFlowEvidenceSchema.safeParse(raw);
    if (!parsed.success) continue;
    const flow = parsed.data;
    const at = Date.parse(flow.timestamp);
    const score = scores.get(flow.wallet);
    if (!score || flow.mint !== input.mint ||
      flow.isDemo !== input.isDemo ||
      flow.freshness !== (input.isDemo ? "DEMO" : "FRESH") ||
      !Number.isFinite(at) || at > end || end - at > FLOW_WINDOW_MS) continue;
    const key = `${flow.wallet}:${flow.signature}:${flow.mint}`;
    unique.set(key, { flow, score });
  }
  const byWallet = new Map<string, Array<{ flow: WalletFlowEvidence; score: WalletCredibilityScore }>>();
  for (const item of unique.values()) byWallet.set(item.flow.wallet, [...(byWallet.get(item.flow.wallet) ?? []), item]);
  const active = new Set([...byWallet.entries()].filter(([, items]) => {
    const newest = [...items].sort((a, b) => b.flow.timestamp.localeCompare(a.flow.timestamp))[0];
    const netQty = items.reduce((sum, x) => sum + (x.flow.side === "BUY" ? x.flow.qty : -x.flow.qty), 0);
    return newest?.flow.side === "BUY" && netQty > 0;
  }).map(([wallet]) => wallet));
  return [...unique.values()].filter((x) => active.has(x.flow.wallet) && x.flow.side === "BUY").sort((a, b) =>
    b.flow.timestamp.localeCompare(a.flow.timestamp) || a.flow.wallet.localeCompare(b.flow.wallet),
  );
}

export function countDistinctWalletGroups(flows: WalletFlowEvidence[], clusters: WalletCluster[] = []): number {
  const wallets = [...new Set(flows.map((f) => f.wallet))];
  const parents = new Map(wallets.map((w) => [w, w]));
  const find = (w: string): string => {
    const p = parents.get(w)!;
    return p === w ? w : find(p);
  };
  for (const cluster of clusters) {
    const members = cluster.wallets.filter((w) => parents.has(w));
    for (const member of members.slice(1)) parents.set(find(member), find(members[0]!));
  }
  const bySignature = new Map<string, string>();
  for (const flow of flows) {
    const earlier = bySignature.get(flow.signature);
    if (earlier && parents.has(flow.wallet)) parents.set(find(flow.wallet), find(earlier));
    else bySignature.set(flow.signature, flow.wallet);
  }
  return new Set(wallets.map(find)).size;
}

export function buildSentinelSignals(input: {
  asset: CandidateAsset;
  marketSignals: SignalResult[];
  wallets: WalletCredibilityScore[];
  walletFlowEvidence?: WalletFlowEvidence[];
  walletClusters?: WalletCluster[];
  tokenRiskTier: string;
  tokenRiskScore: number;
  asOf?: string;
}): SentinelSignal[] {
  const { asset, marketSignals, wallets, tokenRiskTier, tokenRiskScore } = input;
  const asOf = input.asOf ?? nowIso();
  const asOfMs = Date.parse(asOf);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(tokenRiskScore) ||
    tokenRiskTier === "HIGH_RISK" || tokenRiskTier === "INSUFFICIENT_DATA") return [];
  const isDemo = Boolean(asset.isDemo);
  const byName = Object.fromEntries(marketSignals.filter((s) => {
    const at = Date.parse(s.timestamp);
    return Number.isFinite(at) && at <= asOfMs && asOfMs - at <= FLOW_WINDOW_MS &&
      Number.isFinite(s.normalizedScore) && Number.isFinite(s.confidence);
  }).map((s) => [s.name, s]));
  const mom = byName.momentum?.normalizedScore ?? 0;
  const vol = byName.volume?.normalizedScore ?? 0;
  const liq = byName.liquidity?.normalizedScore ?? 0;
  const qualifying = eligibleWalletFlow({
    mint: asset.mint, asOf, isDemo, wallets, evidence: input.walletFlowEvidence ?? [],
  });
  const byWallet = new Map<string, (typeof qualifying)[number]>();
  for (const item of qualifying) if (!byWallet.has(item.flow.wallet)) byWallet.set(item.flow.wallet, item);
  const confirmations = [...byWallet.values()];
  const groups = countDistinctWalletGroups(
    qualifying.map((x) => x.flow), (input.walletClusters ?? []).filter((c) => c.isDemo === isDemo),
  );
  const out: SentinelSignal[] = [];
  const liquidityRisk = (asset.liquidityUsd ?? 0) < 50_000 ? "HIGH" :
    (asset.liquidityUsd ?? 0) < 250_000 ? "ELEVATED" : "MODERATE";
  const flowEvidence = confirmations.map((x) => x.flow);
  const baseProv = [
    `market=${asset.dataSources.join(",") || "unknown"}`,
    `wallets=${confirmations.length}`,
    `tokenRisk=${tokenRiskTier}`,
    isDemo ? "DEMO" : "LIVE_OR_PAPER",
    ...flowEvidence.map((f) => `wallet:${f.wallet}:signature=${f.signature}:mint=${f.mint}:qty=${f.qty}:provider=${f.provider}`),
  ];
  const common = {
    asset: asset.mint, symbol: asset.symbol, timestamp: asOf, tokenRisk: tokenRiskTier,
    liquidityRisk, provenance: baseProv, isDemo, walletFlowEvidence: flowEvidence,
  };
  if (groups >= 2 && mom > 0) {
    const score = Math.min(100, 40 + groups * 8 + mom * 20 + Math.max(0, vol) * 10 - tokenRiskScore * 0.2);
    const confidence = Math.min(0.85, 0.25 + groups * 0.1 + (byName.momentum?.confidence ?? 0) * 0.3);
    out.push(SentinelSignalSchema.parse({
      ...common,
      id: deterministicId(["MULTI_WALLET_ENTRY", asset.mint, asOf, ...flowEvidence.map((f) => f.signature).sort()]),
      signalType: "MULTI_WALLET_ENTRY", score: Number(score.toFixed(1)), confidence: Number(confidence.toFixed(3)),
      walletEvidence: confirmations.map((x) => `${x.flow.wallet.slice(0, 6)}… BUY ${x.flow.qty} in ${x.flow.signature}`),
      marketEvidence: [`momentum ${mom.toFixed(3)}`, `volume ${vol.toFixed(3)}`, `liquidity ${liq.toFixed(3)}`],
      explanation: [
        `${groups} distinct wallet groups bought ${asset.symbol} in the last 24 hours; common ownership is not ruled out`,
        "Score measures evidence strength, not expected profitability",
      ],
      invalidationConditions: ["Confirming wallet evidence ages beyond 24h", "Token-risk upgrades to HIGH_RISK", "Liquidity falls below $50k"],
    }));
  }
  if (confirmations.length && mom > 0.2 && vol > 0.1) {
    const top = [...confirmations].sort((a, b) => b.score.score - a.score.score)[0]!;
    out.push(SentinelSignalSchema.parse({
      ...common,
      id: deterministicId(["MARKET_CONFIRMED_FLOW", asset.mint, asOf, top.flow.signature]),
      signalType: "MARKET_CONFIRMED_FLOW",
      score: Number(Math.min(100, 35 + top.score.score * 0.3 + mom * 25 + vol * 15).toFixed(1)),
      confidence: Number(Math.min(0.8, 0.3 + top.score.confidence * 0.4).toFixed(3)),
      walletEvidence: [`BUY ${top.flow.qty} by ${top.flow.wallet.slice(0, 6)}… in ${top.flow.signature}`],
      marketEvidence: [`momentum ${mom.toFixed(3)}`, `volume ${vol.toFixed(3)}`],
      explanation: ["Observed asset-specific wallet buy coincided with volume and momentum", "Not a guarantee the move continues"],
      invalidationConditions: ["Momentum flips negative on next closed 5m bar", "Wallet evidence ages beyond 24h"],
    }));
  }
  if ((asset.tokenAgeHours ?? 10_000) < 48 && confirmations.length) {
    out.push(SentinelSignalSchema.parse({
      ...common,
      id: deterministicId(["NEW_MARKET_ENTRY", asset.mint, asOf, confirmations[0]!.flow.signature]),
      signalType: "NEW_MARKET_ENTRY", score: 42, confidence: 0.28,
      walletEvidence: confirmations.map((x) => `${x.flow.wallet} BUY ${x.flow.qty} in ${x.flow.signature}`),
      marketEvidence: [`tokenAgeHours=${asset.tokenAgeHours}`],
      explanation: ["Observed wallet buy in a young market; elevated uncertainty"],
      invalidationConditions: ["No follow-through volume within 4h", "Wallet evidence ages beyond 24h"],
    }));
  }
  return out;
}
