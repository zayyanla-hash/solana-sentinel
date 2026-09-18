import {
  type CandidateAsset,
  type SignalResult,
  type MarketRegime,
  createEvent,
  type SystemEvent,
} from "@sat/shared";
import {
  computeHistoricalMomentum,
  computeHistoricalVolume,
  computeHistoricalVolatility,
  computeHistoricalRelativeStrength,
  computeTrendBreakout,
  type HistoricalBars,
} from "./historical";

export {
  SIGNAL_MIN_HISTORY,
  validateOhlcvBars,
  barsAsOf,
  closedBars,
  INTERVAL_MS,
  simpleReturnPct,
  computeHistoricalMomentum,
  computeHistoricalVolume,
  computeHistoricalVolatility,
  computeHistoricalRelativeStrength,
  computeTrendBreakout,
  computeHistoricalSignals,
  type HistoricalBars,
} from "./historical";
export { buildSentinelSignals } from "./sentinel";
export { attachAnalogues, type SignalAnalogue } from "./analogues";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function norm(value: number, scale: number): number {
  return clamp(value / scale, -1, 1);
}

export function computeMomentum(asset: CandidateAsset): SignalResult {
  const missing = [
    asset.priceChange1hPct,
    asset.priceChange24hPct,
    asset.priceChange7dPct,
  ].filter((x) => x == null).length;
  const c1 = asset.priceChange1hPct ?? 0;
  const c24 = asset.priceChange24hPct ?? 0;
  const c7 = asset.priceChange7dPct ?? 0;
  const value = c1 * 0.3 + c24 * 0.5 + c7 * 0.2;
  const confidence =
    [asset.priceChange1hPct, asset.priceChange24hPct, asset.priceChange7dPct].filter(
      (x) => x != null,
    ).length / 3;
  return {
    name: "momentum",
    value,
    normalizedScore: norm(value, 20),
    confidence,
    source: "snapshot-v1.5",
    timestamp: new Date().toISOString(),
    meta: {
      snapshotFallback: true,
      insufficientData: missing > 0,
      reason: missing ? "INSUFFICIENT_DATA" : undefined,
    },
  };
}

export function computeVolume(asset: CandidateAsset): SignalResult {
  const vol = asset.volume24hUsd ?? 0;
  const change = asset.volumeChange24hPct ?? 0;
  const value = Math.log10(Math.max(vol, 1)) + change / 50;
  return {
    name: "volume",
    value,
    normalizedScore: norm(change, 50),
    confidence: asset.volume24hUsd != null ? 0.45 : 0.15,
    source: "snapshot-v1.5",
    timestamp: new Date().toISOString(),
    meta: {
      snapshotFallback: true,
      insufficientData: asset.volume24hUsd == null,
      reason: asset.volume24hUsd == null ? "INSUFFICIENT_DATA" : "SNAPSHOT_ONLY",
    },
  };
}

export function computeLiquidity(asset: CandidateAsset): SignalResult {
  const liq = asset.liquidityUsd ?? 0;
  const value = Math.log10(Math.max(liq, 1));
  const normalizedScore = clamp((value - 5) / 3, -1, 1);
  return {
    name: "liquidity",
    value: liq,
    normalizedScore,
    confidence: asset.liquidityUsd != null ? 0.9 : 0.1,
    source: "snapshot-v1.5",
    timestamp: new Date().toISOString(),
    meta: { insufficientData: asset.liquidityUsd == null },
  };
}

/**
 * Relative strength vs an explicit benchmark return.
 * Never uses a hardcoded +2% stand-in. Missing benchmark → INSUFFICIENT_DATA.
 */
export function computeRelativeStrength(
  asset: CandidateAsset,
  benchmarkChangePct: number | null = null,
  benchmarkLabel = "SOL",
): SignalResult {
  if (benchmarkChangePct == null || asset.priceChange24hPct == null) {
    return {
      name: "relative_strength",
      value: 0,
      normalizedScore: 0,
      confidence: 0.1,
      source: "snapshot-v1.5",
      timestamp: new Date().toISOString(),
      meta: {
        insufficientData: true,
        reason: "NO_BENCHMARK",
        hardcodedBenchmark: false,
        benchmark: benchmarkLabel,
      },
    };
  }
  const rs = asset.priceChange24hPct - benchmarkChangePct;
  return {
    name: "relative_strength",
    value: rs,
    normalizedScore: norm(rs, 15),
    confidence: 0.7,
    source: "snapshot-v1.5",
    timestamp: new Date().toISOString(),
    meta: { benchmarkChangePct, benchmark: benchmarkLabel, hardcodedBenchmark: false },
  };
}

export function computeVolatility(asset: CandidateAsset): SignalResult {
  const have = [asset.priceChange1hPct, asset.priceChange24hPct, asset.priceChange7dPct].filter(
    (x) => x != null,
  ).length;
  if (have === 0) {
    return {
      name: "volatility",
      value: 0,
      normalizedScore: 0,
      confidence: 0.1,
      source: "snapshot-v1.5",
      timestamp: new Date().toISOString(),
      meta: { insufficientData: true, reason: "INSUFFICIENT_DATA" },
    };
  }
  const moves = [
    Math.abs(asset.priceChange1hPct ?? 0) * 24,
    Math.abs(asset.priceChange24hPct ?? 0),
    Math.abs(asset.priceChange7dPct ?? 0) / 7,
  ];
  const value = moves.reduce((a, b) => a + b, 0) / moves.length;
  return {
    name: "volatility",
    value,
    normalizedScore: -norm(value, 25),
    confidence: 0.4,
    source: "snapshot-v1.5",
    timestamp: new Date().toISOString(),
    meta: { snapshotFallback: true },
  };
}

export function computeMarketRegime(assets: CandidateAsset[]): {
  regime: MarketRegime;
  signal: SignalResult;
} {
  const changes = assets
    .map((a) => a.priceChange24hPct)
    .filter((x): x is number => x != null);
  const avg = changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : 0;
  const vols = assets.map((a) => Math.abs(a.priceChange24hPct ?? 0));
  const avgVol = vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : 0;

  let regime: MarketRegime = "NEUTRAL";
  if (avgVol > 12) regime = "HIGH_VOLATILITY";
  else if (avg > 3) regime = "RISK_ON";
  else if (avg < -3) regime = "RISK_OFF";

  const scoreMap: Record<MarketRegime, number> = {
    RISK_ON: 0.6,
    NEUTRAL: 0.1,
    RISK_OFF: -0.5,
    HIGH_VOLATILITY: -0.3,
  };

  return {
    regime,
    signal: {
      name: "market_regime",
      value: avg,
      normalizedScore: scoreMap[regime],
      confidence: changes.length >= 3 ? 0.75 : 0.4,
      source: "snapshot-v1.5",
      timestamp: new Date().toISOString(),
      meta: { regime, avgVol, insufficientData: changes.length < 3 },
    },
  };
}

export function computeOnChain(asset: CandidateAsset): SignalResult {
  const holders = asset.holderCount ?? 0;
  const age = asset.tokenAgeHours ?? 0;
  const holderScore = clamp(Math.log10(Math.max(holders, 1)) / 6, 0, 1);
  const ageScore = clamp(age / (24 * 365), 0, 1);
  const value = (holderScore + ageScore) / 2;
  return {
    name: "on_chain",
    value,
    normalizedScore: value * 2 - 1,
    confidence: asset.holderCount != null && asset.tokenAgeHours != null ? 0.8 : 0.35,
    source: "snapshot-v1.5",
    timestamp: new Date().toISOString(),
    meta: {
      insufficientData: asset.holderCount == null || asset.tokenAgeHours == null,
    },
  };
}

function pickHistoricalOrSnapshot(hist: SignalResult, snapshot: SignalResult): SignalResult {
  if (hist.meta?.insufficientData) {
    return {
      ...snapshot,
      meta: {
        ...snapshot.meta,
        fallback: "snapshot",
        historicalInsufficient: true,
        historicalReason: hist.meta.reason,
      },
    };
  }
  return hist;
}

function historicalUsable(historical?: HistoricalBars): boolean {
  if (!historical) return false;
  return Boolean(
    historical["1m"]?.length ||
      historical["5m"]?.length ||
      historical["15m"]?.length ||
      historical["1h"]?.length ||
      historical["4h"]?.length,
  );
}

export function computeAllSignals(
  asset: CandidateAsset,
  universe: CandidateAsset[] = [asset],
  historical?: HistoricalBars,
): { signals: SignalResult[]; events: SystemEvent[]; regime: MarketRegime } {
  const { regime, signal: regimeSignal } = computeMarketRegime(universe);
  const solAsset = universe.find((a) => a.symbol === "SOL");
  const snapshotRs = computeRelativeStrength(
    asset,
    solAsset?.priceChange24hPct ?? null,
    "SOL",
  );

  const useHist = historicalUsable(historical);
  const momentum = useHist && historical
    ? pickHistoricalOrSnapshot(computeHistoricalMomentum(historical), computeMomentum(asset))
    : computeMomentum(asset);
  const volume = useHist && historical
    ? pickHistoricalOrSnapshot(computeHistoricalVolume(historical), computeVolume(asset))
    : computeVolume(asset);
  const volatility =
    useHist && historical
      ? pickHistoricalOrSnapshot(computeHistoricalVolatility(historical), computeVolatility(asset))
      : computeVolatility(asset);
  const relativeStrength =
    useHist && historical
      ? pickHistoricalOrSnapshot(computeHistoricalRelativeStrength(historical), snapshotRs)
      : snapshotRs;
  const trend = historical
    ? computeTrendBreakout(historical)
    : {
        name: "trend_breakout" as const,
        value: 0,
        normalizedScore: 0,
        confidence: 0.1,
        source: "snapshot-v1.5",
        timestamp: new Date().toISOString(),
        meta: { insufficientData: true, reason: "INSUFFICIENT_DATA" },
      };

  const signals = [
    momentum,
    volume,
    computeLiquidity(asset),
    relativeStrength,
    volatility,
    regimeSignal,
    computeOnChain(asset),
    trend,
  ];
  const events = signals.map((s) =>
    createEvent("SIGNAL_GENERATED", `${s.name}=${s.normalizedScore.toFixed(3)}`, {
      mint: asset.mint,
      payload: { signal: s },
    }),
  );
  return { signals, events, regime };
}

export function scoreOpportunity(
  asset: CandidateAsset,
  signals: SignalResult[],
  opts: {
    weights: Record<string, number>;
    strategyConfigVersion: string;
    riskScore?: number;
    researchConfidence?: number;
  },
): {
  compositeScore: number;
  gateScore: number;
  components: Record<string, number>;
  explanation: string[];
  signalSources: Record<string, string>;
} {
  const byName = Object.fromEntries(signals.map((s) => [s.name, s]));
  const to01 = (n: number) => (n + 1) / 2;
  const conf = (name: string, fallback = 0.5) => byName[name]?.confidence ?? fallback;

  const components: Record<string, number> = {
    momentum: to01(byName.momentum?.normalizedScore ?? 0) * 100,
    volume: to01(byName.volume?.normalizedScore ?? 0) * 100,
    liquidity: to01(byName.liquidity?.normalizedScore ?? 0) * 100,
    relativeStrength: to01(byName.relative_strength?.normalizedScore ?? 0) * 100,
    regime: to01(byName.market_regime?.normalizedScore ?? 0) * 100,
    onChain: to01(byName.on_chain?.normalizedScore ?? 0) * 100,
    trendBreakout: to01(byName.trend_breakout?.normalizedScore ?? 0) * 100,
    riskReward: opts.riskScore != null ? clamp(100 - opts.riskScore, 0, 100) : 50,
    research: (opts.researchConfidence ?? 0.5) * 100,
  };

  const w = opts.weights;
  const pairs: Array<[string, number, number, number]> = [
    ["momentum", w.momentum ?? 0, components.momentum ?? 0, conf("momentum")],
    ["volume", w.volume ?? 0, components.volume ?? 0, conf("volume")],
    ["liquidity", w.liquidity ?? 0, components.liquidity ?? 0, conf("liquidity")],
    ["relativeStrength", w.relativeStrength ?? 0, components.relativeStrength ?? 0, conf("relative_strength")],
    ["regime", w.regime ?? 0, components.regime ?? 0, conf("market_regime")],
    ["onChain", w.onChain ?? 0, components.onChain ?? 0, conf("on_chain")],
    ["trendBreakout", w.trendBreakout ?? 0, components.trendBreakout ?? 0, conf("trend_breakout")],
    ["riskReward", w.riskReward ?? 0, components.riskReward ?? 0, 1],
    ["research", w.research ?? 0, components.research ?? 0, 1],
  ];

  const weighted = (excludeResearch: boolean) => {
    let num = 0;
    let den = 0;
    for (const [name, weight, value, c] of pairs) {
      if (excludeResearch && name === "research") continue;
      const ew = weight * c;
      num += value * ew;
      den += ew;
    }
    return den > 0 ? num / den : 50;
  };

  const compositeScore = weighted(false);
  const gateScore = weighted(true);
  const signalSources = Object.fromEntries(
    signals.map((s) => [s.name, String(s.source)]),
  );

  const explanation = [
    `Composite ${compositeScore.toFixed(1)} (gate ${gateScore.toFixed(1)}, research excluded from gate) using ${opts.strategyConfigVersion}`,
    `Momentum ${components.momentum?.toFixed(0)} (w=${w.momentum ?? 0})`,
    `Trend/breakout ${components.trendBreakout?.toFixed(0)} (w=${w.trendBreakout ?? 0})`,
    `Liquidity ${components.liquidity?.toFixed(0)} (w=${w.liquidity ?? 0})`,
    `Risk/reward ${components.riskReward?.toFixed(0)} (w=${w.riskReward ?? 0})`,
  ];

  return { compositeScore, gateScore, components, explanation, signalSources };
}
