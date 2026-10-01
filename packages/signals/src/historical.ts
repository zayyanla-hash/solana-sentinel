import {
  type CandidateAsset,
  type OhlcvBar,
  type OhlcvInterval,
  type SignalResult,
  OhlcvBarSchema,
} from "@sat/shared";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function norm(value: number, scale: number): number {
  return clamp(value / scale, -1, 1);
}

/** Minimum bars required per historical feature. Missing history → INSUFFICIENT_DATA, no invented bars. */
export const SIGNAL_MIN_HISTORY = {
  momentum5mReturn: {
    interval: "5m" as const,
    bars: 2,
    description: "Two 5-minute closes for a 5m simple return",
  },
  momentum15mReturn: {
    interval: "15m" as const,
    bars: 2,
    description: "Two 15-minute closes for a 15m simple return",
  },
  momentum1hReturn: {
    interval: "1h" as const,
    bars: 2,
    description: "Two 1-hour closes for a 1h simple return",
  },
  momentumAcceleration: {
    interval: "5m" as const,
    bars: 3,
    description: "Three 5-minute closes so acceleration = r_t - r_{t-1}",
  },
  volumeBaseline: {
    interval: "5m" as const,
    bars: 20,
    description: "Mean volume of the prior 20 bars (excludes the current bar)",
  },
  volumeRelative: {
    interval: "5m" as const,
    bars: 21,
    description: "Current bar volume vs 20-bar baseline",
  },
  volumeAcceleration: {
    interval: "5m" as const,
    bars: 3,
    description: "Three volume observations for volume acceleration",
  },
  realizedVol: {
    interval: "5m" as const,
    bars: 12,
    description: "12 log-returns (~1 hour of 5m bars) for realized volatility",
  },
  volExpansion: {
    interval: "5m" as const,
    bars: 24,
    description: "Short realized vol vs a longer 24-bar window",
  },
  relativeStrengthSol: {
    interval: "5m" as const,
    bars: 2,
    description: "Aligned token and SOL bars; never a hardcoded +2% benchmark",
  },
  relativeStrengthBtc: {
    interval: "5m" as const,
    bars: 2,
    description: "Optional BTC bars; omitted when unavailable",
  },
  trendBreakout: {
    interval: "1h" as const,
    bars: 20,
    description: "20 hourly highs/lows; 5m used only as a coarser fallback when 1h is missing",
  },
} as const;

export interface HistoricalBars {
  "1m"?: OhlcvBar[];
  "5m"?: OhlcvBar[];
  "15m"?: OhlcvBar[];
  "1h"?: OhlcvBar[];
  "4h"?: OhlcvBar[];
  "1d"?: OhlcvBar[];
  sol?: Partial<Record<OhlcvInterval, OhlcvBar[]>>;
  btc?: Partial<Record<OhlcvInterval, OhlcvBar[]>>;
  asOfMs?: number;
}

export function validateOhlcvBars(raw: unknown[]): OhlcvBar[] {
  const out: OhlcvBar[] = [];
  for (const item of raw) {
    const parsed = OhlcvBarSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

export function barsAsOf(bars: OhlcvBar[] | undefined, asOfMs?: number): OhlcvBar[] {
  if (!bars?.length) return [];
  const cut = asOfMs ?? Number.POSITIVE_INFINITY;
  return bars.filter((b) => b.timestamp <= cut).sort((a, b) => a.timestamp - b.timestamp);
}

export const INTERVAL_MS: Record<OhlcvInterval, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

/** Drop in-progress bars so signals only see closed candles. */
export function closedBars(
  bars: OhlcvBar[] | undefined,
  interval: OhlcvInterval,
  asOfMs?: number,
): { bars: OhlcvBar[]; barsDropped: number } {
  const cut = asOfMs ?? Date.now();
  const width = INTERVAL_MS[interval];
  const asOf = barsAsOf(bars, cut);
  const closed = asOf.filter((b) => b.timestamp + width <= cut);
  return { bars: closed, barsDropped: asOf.length - closed.length };
}

/** Prefer requested interval; if missing, use the next coarser available interval (never interpolate). Closed bars only. */
export function barsForInterval(hist: HistoricalBars, interval: OhlcvInterval): OhlcvBar[] {
  const asOfMs = hist.asOfMs;
  const order: OhlcvInterval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];
  const start = order.indexOf(interval);
  const candidates = start >= 0 ? order.slice(start) : order;
  for (const i of candidates) {
    const { bars } = closedBars(hist[i], i, asOfMs);
    if (bars.length) return bars;
  }
  return [];
}

export function simpleReturnPct(bars: OhlcvBar[], lookback = 1): number | null {
  if (bars.length < lookback + 1) return null;
  const last = bars[bars.length - 1]!;
  const prev = bars[bars.length - 1 - lookback]!;
  if (prev.close <= 0) return null;
  return ((last.close - prev.close) / prev.close) * 100;
}

export function logReturns(bars: OhlcvBar[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]!.close;
    const cur = bars[i]!.close;
    if (prev > 0 && cur > 0) out.push(Math.log(cur / prev));
  }
  return out;
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

function insufficient(
  name: SignalResult["name"],
  reason: string,
  extra: Record<string, unknown> = {},
): SignalResult {
  return {
    name,
    value: 0,
    normalizedScore: 0,
    confidence: 0.1,
    source: "historical-v1.5",
    timestamp: new Date().toISOString(),
    meta: { insufficientData: true, reason, ...extra },
  };
}

export function computeHistoricalMomentum(hist: HistoricalBars): SignalResult {
  const b5 = barsForInterval(hist, "5m");
  const b15 = barsForInterval(hist, "15m");
  const b1h = barsForInterval(hist, "1h");
  const r5 = simpleReturnPct(b5, 1);
  const r15 = simpleReturnPct(b15, 1);
  const r1h = simpleReturnPct(b1h, 1);
  const r5prev = b5.length >= 3 ? simpleReturnPct(b5.slice(0, -1), 1) : null;
  const accel = r5 != null && r5prev != null ? r5 - r5prev : null;

  const present = [r5, r15, r1h].filter((x) => x != null).length;
  if (present === 0) {
    return insufficient("momentum", "INSUFFICIENT_DATA", {
      need: SIGNAL_MIN_HISTORY.momentum5mReturn,
    });
  }

  const value = (r5 ?? 0) * 0.45 + (r15 ?? 0) * 0.35 + (r1h ?? 0) * 0.2;
  const confidence = clamp(0.25 + present * 0.22 + (accel != null ? 0.1 : 0), 0, 1);
  return {
    name: "momentum",
    value,
    normalizedScore: norm(value, 8),
    confidence,
    source: "historical-v1.5",
    timestamp: new Date().toISOString(),
    meta: {
      return5mPct: r5,
      return15mPct: r15,
      return1hPct: r1h,
      acceleration5m: accel,
      bars: { "5m": b5.length, "15m": b15.length, "1h": b1h.length },
    },
  };
}

export function computeHistoricalVolume(hist: HistoricalBars): SignalResult {
  const bars = barsForInterval(hist, "5m");
  if (bars.length < SIGNAL_MIN_HISTORY.volumeBaseline.bars) {
    return insufficient("volume", "INSUFFICIENT_DATA", {
      need: SIGNAL_MIN_HISTORY.volumeBaseline,
      have: bars.length,
    });
  }
  const current = bars[bars.length - 1]!;
  const baselineBars = bars.slice(-21, -1);
  const baseline = mean(baselineBars.map((b) => b.volume));
  const relative = baseline > 0 ? current.volume / baseline : null;
  const vPrev = bars.length >= 3 ? bars[bars.length - 2]!.volume : null;
  const vPrev2 = bars.length >= 3 ? bars[bars.length - 3]!.volume : null;
  const accel =
    relative != null && vPrev != null && vPrev2 != null && vPrev2 > 0
      ? vPrev / vPrev2 - 1
      : null;
  const value = relative != null ? (relative - 1) * 100 : 0;
  return {
    name: "volume",
    value,
    normalizedScore: norm(value, 80),
    confidence: relative != null ? 0.85 : 0.3,
    source: "historical-v1.5",
    timestamp: new Date().toISOString(),
    meta: {
      baselineVolume: baseline,
      relativeVolume: relative,
      volumeAcceleration: accel,
      currentVolume: current.volume,
    },
  };
}

export function computeHistoricalVolatility(hist: HistoricalBars): SignalResult {
  const bars = barsForInterval(hist, "5m");
  if (bars.length < SIGNAL_MIN_HISTORY.realizedVol.bars) {
    return insufficient("volatility", "INSUFFICIENT_DATA", {
      need: SIGNAL_MIN_HISTORY.realizedVol,
      have: bars.length,
    });
  }
  const rets = logReturns(bars.slice(-12));
  const realized = stdev(rets);
  const longer =
    bars.length >= SIGNAL_MIN_HISTORY.volExpansion.bars
      ? stdev(logReturns(bars.slice(-24)))
      : null;
  const expansion = longer && longer > 0 ? realized / longer : null;
  const annualizedPct = realized * Math.sqrt(365 * 24 * 12) * 100;
  return {
    name: "volatility",
    value: annualizedPct,
    normalizedScore: -norm(annualizedPct, 80),
    confidence: expansion != null ? 0.8 : 0.55,
    source: "historical-v1.5",
    timestamp: new Date().toISOString(),
    meta: {
      realizedVol: realized,
      volExpansion: expansion,
      sampleReturns: rets.length,
    },
  };
}

export function computeHistoricalRelativeStrength(hist: HistoricalBars): SignalResult {
  const token = barsForInterval(hist, "5m");
  const { bars: solClosed } = closedBars(
    hist.sol?.["5m"] ?? hist.sol?.["15m"] ?? hist.sol?.["1h"],
    hist.sol?.["5m"] ? "5m" : hist.sol?.["15m"] ? "15m" : "1h",
    hist.asOfMs,
  );
  const rToken = simpleReturnPct(token, 1);
  const rSol = simpleReturnPct(solClosed, 1);
  if (rToken == null || rSol == null) {
    return insufficient("relative_strength", "INSUFFICIENT_DATA", {
      reason: "NO_BENCHMARK",
      haveTokenBars: token.length,
      haveSolBars: solClosed.length,
      hardcodedBenchmark: false,
    });
  }
  const rs = rToken - rSol;
  const { bars: btcClosed } = closedBars(hist.btc?.["5m"], "5m", hist.asOfMs);
  const rBtc = simpleReturnPct(btcClosed, 1);
  return {
    name: "relative_strength",
    value: rs,
    normalizedScore: norm(rs, 6),
    confidence: rBtc != null ? 0.85 : 0.75,
    source: "historical-v1.5",
    timestamp: new Date().toISOString(),
    meta: {
      tokenReturn5mPct: rToken,
      solReturn5mPct: rSol,
      btcReturn5mPct: rBtc,
      vs: "SOL",
      hardcodedBenchmark: false,
    },
  };
}

export function computeTrendBreakout(hist: HistoricalBars): SignalResult {
  let bars = barsForInterval(hist, "1h");
  let intervalUsed: OhlcvInterval = "1h";
  if (bars.length < SIGNAL_MIN_HISTORY.trendBreakout.bars) {
    bars = barsForInterval(hist, "5m");
    intervalUsed = "5m";
  }
  if (bars.length < SIGNAL_MIN_HISTORY.trendBreakout.bars) {
    return insufficient("trend_breakout", "INSUFFICIENT_DATA", {
      need: SIGNAL_MIN_HISTORY.trendBreakout,
      have: bars.length,
    });
  }
  const window = bars.slice(-20);
  const last = window[window.length - 1]!;
  const prior = window.slice(0, -1);
  const rollingHigh = Math.max(...prior.map((b) => b.high));
  const rollingLow = Math.min(...prior.map((b) => b.low));
  const range = rollingHigh - rollingLow;
  const breakoutDistance = rollingHigh > 0 ? (last.close - rollingHigh) / rollingHigh : 0;
  let persistence = 0;
  for (let i = window.length - 1; i >= 0; i--) {
    const b = window[i]!;
    if (rollingHigh > 0 && b.close >= rollingHigh * 0.995) persistence++;
    else break;
  }
  const value = breakoutDistance * 100;
  return {
    name: "trend_breakout",
    value,
    normalizedScore: clamp(breakoutDistance * 8, -1, 1),
    confidence: 0.7,
    source: "historical-v1.5",
    timestamp: new Date().toISOString(),
    meta: {
      intervalUsed,
      rollingHigh,
      rollingLow,
      breakoutDistance,
      persistence,
      range,
    },
  };
}

export function computeHistoricalSignals(
  _asset: CandidateAsset,
  hist: HistoricalBars,
): SignalResult[] {
  return [
    computeHistoricalMomentum(hist),
    computeHistoricalVolume(hist),
    computeHistoricalVolatility(hist),
    computeHistoricalRelativeStrength(hist),
    computeTrendBreakout(hist),
  ];
}
