/**
 * validation-lab: standalone deterministic validation for externally supplied
 * timestamped equity and trade observations.
 *
 * Rules: never invents prices or trajectories. Benchmarks, costs and latency
 * rows are computed only from supplied observations; otherwise they are
 * omitted with a reason. Insufficient input yields INSUFFICIENT_HISTORY with
 * metrics hidden, never a fabricated trajectory.
 */

export const ENGINE_VERSION = "validation-lab-v1";

export type ValidationStatus = "OK" | "INSUFFICIENT_HISTORY";

export interface EquityObservation {
  t: string;
  nav: number;
}

export interface TradeObservation {
  t: string;
  side: "BUY" | "SELL";
  price: number;
  qty: number;
  feeUsd?: number;
}

export interface BenchmarkObservation {
  t: string;
  value: number;
}

export interface SplitFractions {
  train: number;
  validation: number;
  oos: number;
}

export interface CostScenario {
  label: string;
  feeMultiplier: number;
  extraSlippageBps: number;
}

export interface ValidationConfig {
  split: SplitFractions;
  minTotalPoints: number;
  minOosPoints: number;
  periodsPerYear: number;
  seed: number;
  walkForwardFolds: number;
  bootstrapSamples: number;
  costScenarios: CostScenario[];
  latencyStepsMs: number[];
  latencyBpsPer100ms: number;
}

export interface SegmentSlice {
  label: "train" | "validation" | "oos";
  startIndex: number;
  endIndex: number;
  startTime: string;
  endTime: string;
  points: number;
  spanMs: number;
}

export interface SegmentMetrics {
  points: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  sharpe: number | null;
  sortino: number | null;
  volatilityPctAnn: number | null;
  /** Fraction of positive interval returns (not a trade win rate). */
  positivePeriodRate: number | null;
  tradeCount: number;
  costDragUsd: number;
  warnings: string[];
}

export interface BenchmarkComparison {
  benchmarkPoints: number;
  strategyOosReturnPct: number;
  benchmarkOosReturnPct: number;
  excessReturnPct: number;
  benchmarkMaxDrawdownPct: number;
}

export interface CostSensitivityRow {
  label: string;
  feeMultiplier: number;
  extraSlippageBps: number;
  extraDragUsd: number;
  /** Observed OOS return after only the scenario's incremental cost drag. */
  oosReturnAfterExtraCostsPct: number;
}

export interface LatencySensitivityRow {
  label: string;
  addedLatencyMs: number;
  penaltyBps: number;
  extraDragUsd: number;
  /** Observed OOS return after only the hypothetical latency drag. */
  oosReturnAfterExtraCostsPct: number;
}

export interface WalkForwardFold {
  /** Chronological fold summary over the fixed supplied NAV path; no model retraining is performed. */
  fold: number;
  trainEndIndex: number;
  testStartIndex: number;
  testEndIndex: number;
  testReturnPct: number;
}

export interface BootstrapSummary {
  samples: number;
  meanTotalReturnPct: number;
  p5TotalReturnPct: number;
  p50TotalReturnPct: number;
  p95TotalReturnPct: number;
}

export interface ValidationProvenance {
  engineVersion: string;
  seed: number;
  config: ValidationConfig;
  inputDigest: string;
  dataSource: string;
  clockIso: string;
}

export interface ValidationResult {
  status: ValidationStatus;
  warnings: string[];
  segments: { train: SegmentSlice; validation: SegmentSlice; oos: SegmentSlice };
  metrics: { train: SegmentMetrics; validation: SegmentMetrics; oos: SegmentMetrics } | null;
  benchmark: BenchmarkComparison | null;
  benchmarkOmittedReason: string | null;
  costSensitivity: CostSensitivityRow[] | null;
  costOmittedReason: string | null;
  latencySensitivity: LatencySensitivityRow[] | null;
  latencyOmittedReason: string | null;
  walkForward: WalkForwardFold[] | null;
  walkForwardOmittedReason: string | null;
  bootstrap: BootstrapSummary | null;
  bootstrapOmittedReason: string | null;
  provenance: ValidationProvenance;
}

export type ValidationInput = {
  equity: EquityObservation[];
  trades?: TradeObservation[];
  benchmark?: BenchmarkObservation[];
  config?: Partial<ValidationConfig>;
  dataSource?: string;
  clockIso?: string;
};

export class ValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code} — ${message}`);
    this.name = "ValidationError";
    this.code = code;
  }
}

export const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  split: { train: 0.6, validation: 0.2, oos: 0.2 },
  minTotalPoints: 30,
  minOosPoints: 10,
  periodsPerYear: 252,
  seed: 7,
  walkForwardFolds: 3,
  bootstrapSamples: 1000,
  costScenarios: [
    { label: "base", feeMultiplier: 1, extraSlippageBps: 0 },
    { label: "fees-x2", feeMultiplier: 2, extraSlippageBps: 0 },
    { label: "slip-50bps", feeMultiplier: 1, extraSlippageBps: 50 },
  ],
  latencyStepsMs: [0, 100, 500],
  latencyBpsPer100ms: 5,
};

export function resolveConfig(partial?: Partial<ValidationConfig>): ValidationConfig {
  const base = structuredClone(DEFAULT_VALIDATION_CONFIG);
  if (!partial) return base;
  const merged: ValidationConfig = {
    ...base,
    ...partial,
    split: { ...base.split, ...(partial.split ?? {}) },
    costScenarios: partial.costScenarios ?? base.costScenarios,
    latencyStepsMs: partial.latencyStepsMs ?? base.latencyStepsMs,
  };
  const { train, validation, oos } = merged.split;
  for (const [k, v] of Object.entries(merged.split) as Array<[string, number]>) {
    if (!Number.isFinite(v) || v <= 0) {
      throw new ValidationError("INVALID_SPLIT", `split.${k} must be a finite number > 0`);
    }
  }
  const sum = train + validation + oos;
  if (Math.abs(sum - 1) > 1e-9) {
    throw new ValidationError("INVALID_SPLIT", `split fractions must sum to 1, got ${sum}`);
  }
  if (!Number.isInteger(merged.minTotalPoints) || merged.minTotalPoints < 3) {
    throw new ValidationError("INVALID_CONFIG", "minTotalPoints must be an integer >= 3");
  }
  if (!Number.isInteger(merged.minOosPoints) || merged.minOosPoints < 2) {
    throw new ValidationError("INVALID_CONFIG", "minOosPoints must be an integer >= 2");
  }
  if (!Number.isFinite(merged.periodsPerYear) || merged.periodsPerYear <= 0) {
    throw new ValidationError("INVALID_CONFIG", "periodsPerYear must be finite > 0");
  }
  if (!Number.isInteger(merged.seed) || merged.seed < 0) {
    throw new ValidationError("INVALID_CONFIG", "seed must be a non-negative integer");
  }
  if (!Number.isInteger(merged.walkForwardFolds) || merged.walkForwardFolds < 0) {
    throw new ValidationError("INVALID_CONFIG", "walkForwardFolds must be an integer >= 0");
  }
  if (
    !Number.isInteger(merged.bootstrapSamples) ||
    merged.bootstrapSamples < 0 ||
    merged.bootstrapSamples > 5000
  ) {
    throw new ValidationError("INVALID_CONFIG", "bootstrapSamples must be an integer in [0, 5000]");
  }
  for (const s of merged.costScenarios) {
    if (!Number.isFinite(s.feeMultiplier) || s.feeMultiplier < 1) {
      throw new ValidationError("INVALID_CONFIG", `cost scenario "${s.label}" feeMultiplier must be >= 1`);
    }
    if (!Number.isFinite(s.extraSlippageBps) || s.extraSlippageBps < 0) {
      throw new ValidationError("INVALID_CONFIG", `cost scenario "${s.label}" extraSlippageBps must be >= 0`);
    }
  }
  if (!Array.isArray(merged.latencyStepsMs) || merged.latencyStepsMs.some((ms) => !Number.isFinite(ms) || ms < 0)) {
    throw new ValidationError("INVALID_CONFIG", "latencyStepsMs must contain only finite non-negative values");
  }
  if (!Number.isFinite(merged.latencyBpsPer100ms) || merged.latencyBpsPer100ms < 0) {
    throw new ValidationError("INVALID_CONFIG", "latencyBpsPer100ms must be finite and non-negative");
  }
  return merged;
}

function parseTimeMs(t: unknown, what: string): number {
  if (typeof t !== "string" || t.length === 0) {
    throw new ValidationError("BAD_TIMESTAMP", `${what} has a non-string or empty timestamp`);
  }
  const ms = Date.parse(t);
  if (!Number.isFinite(ms)) {
    throw new ValidationError("BAD_TIMESTAMP", `${what} has an unparseable timestamp: ${t}`);
  }
  return ms;
}

interface ParsedEquity {
  t: string;
  ms: number;
  nav: number;
}

interface ParsedTrade extends ParsedEquity {
  side: "BUY" | "SELL";
  price: number;
  qty: number;
  feeUsd: number;
}

function parseEquity(equity: EquityObservation[]): ParsedEquity[] {
  if (!Array.isArray(equity)) throw new ValidationError("INVALID_EQUITY", "equity must be an array");
  const out: ParsedEquity[] = equity.map((p, i) => {
    const ms = parseTimeMs((p as EquityObservation)?.t, `equity[${i}]`);
    const nav = (p as EquityObservation)?.nav;
    if (!Number.isFinite(nav) || nav <= 0) {
      throw new ValidationError("INVALID_EQUITY", `equity[${i}] nav must be finite > 0`);
    }
    return { t: (p as EquityObservation).t, ms, nav };
  });
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1]!;
    const cur = out[i]!;
    if (cur.ms === prev.ms) {
      throw new ValidationError("DUPLICATE_TIMESTAMP", `equity[${i}] duplicates timestamp ${cur.t}`);
    }
    if (cur.ms < prev.ms) {
      throw new ValidationError(
        "NON_MONOTONIC_TIMESTAMPS",
        `equity[${i}] timestamp ${cur.t} precedes equity[${i - 1}] ${prev.t}; input must arrive in strictly increasing time order`,
      );
    }
  }
  return out;
}

function parseTrades(trades: TradeObservation[] | undefined, lo: number, hi: number): ParsedTrade[] {
  if (trades === undefined) return [];
  if (!Array.isArray(trades)) throw new ValidationError("INVALID_TRADE", "trades must be an array");
  const out: ParsedTrade[] = trades.map((r, i) => {
    const ms = parseTimeMs((r as TradeObservation)?.t, `trades[${i}]`);
    const side = (r as TradeObservation)?.side;
    if (side !== "BUY" && side !== "SELL") {
      throw new ValidationError("INVALID_TRADE", `trades[${i}] side must be BUY or SELL`);
    }
    const price = (r as TradeObservation)?.price;
    const qty = (r as TradeObservation)?.qty;
    if (!Number.isFinite(price) || price <= 0) {
      throw new ValidationError("INVALID_TRADE", `trades[${i}] price must be finite > 0`);
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new ValidationError("INVALID_TRADE", `trades[${i}] qty must be finite > 0`);
    }
    const feeUsd = (r as TradeObservation)?.feeUsd ?? 0;
    if (!Number.isFinite(feeUsd) || feeUsd < 0) {
      throw new ValidationError("INVALID_TRADE", `trades[${i}] feeUsd must be finite >= 0`);
    }
    if (ms < lo || ms > hi) {
      throw new ValidationError(
        "TRADE_OUT_OF_RANGE",
        `trades[${i}] timestamp ${r.t} falls outside the equity observation window`,
      );
    }
    return { t: (r as TradeObservation).t, ms, nav: 0, side, price, qty, feeUsd };
  });
  const seen = new Set<string>();
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1]!;
    const cur = out[i]!;
    if (cur.ms === prev.ms) {
      throw new ValidationError("DUPLICATE_TRADE_TIMESTAMP", `trades[${i}] duplicates timestamp ${cur.t}`);
    }
    if (cur.ms < prev.ms) {
      throw new ValidationError(
        "NON_MONOTONIC_TIMESTAMPS",
        `trades[${i}] timestamp ${cur.t} precedes trades[${i - 1}] ${prev.t}`,
      );
    }
  }
  for (const r of out) {
    const key = `${r.ms}|${r.side}|${r.price}|${r.qty}`;
    if (seen.has(key)) throw new ValidationError("DUPLICATE_TRADE", `duplicate trade entry at ${r.t}`);
    seen.add(key);
  }
  return out;
}

function parseBenchmark(rows: BenchmarkObservation[] | undefined): Array<{ t: string; ms: number; value: number }> {
  if (rows === undefined) return [];
  if (!Array.isArray(rows)) throw new ValidationError("INVALID_BENCHMARK", "benchmark must be an array");
  const out = rows.map((p, i) => {
    const ms = parseTimeMs((p as BenchmarkObservation)?.t, `benchmark[${i}]`);
    const value = (p as BenchmarkObservation)?.value;
    if (!Number.isFinite(value) || value <= 0) {
      throw new ValidationError("INVALID_BENCHMARK", `benchmark[${i}] value must be finite > 0`);
    }
    return { t: (p as BenchmarkObservation).t, ms, value };
  });
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1]!;
    const cur = out[i]!;
    if (cur.ms === prev.ms) {
      throw new ValidationError("DUPLICATE_TIMESTAMP", `benchmark[${i}] duplicates timestamp ${cur.t}`);
    }
    if (cur.ms < prev.ms) {
      throw new ValidationError(
        "NON_MONOTONIC_TIMESTAMPS",
        `benchmark[${i}] timestamp ${cur.t} precedes benchmark[${i - 1}] ${prev.t}`,
      );
    }
  }
  return out;
}

function simpleReturns(navs: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < navs.length; i++) {
    const prev = navs[i - 1]!;
    out.push((navs[i]! - prev) / prev);
  }
  return out;
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdevSample(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

function maxDrawdownPct(navs: number[]): number {
  let peak = navs[0] ?? 0;
  let dd = 0;
  for (const v of navs) {
    if (v > peak) peak = v;
    if (peak > 0) dd = Math.max(dd, (peak - v) / peak);
  }
  return dd * 100;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/** Deterministic FNV-1a digest over the canonical input envelope. */
export function digestInputs(envelope: unknown): string {
  const text = JSON.stringify(envelope);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `fnv1a-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/** Seeded deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

function computeSegmentMetrics(
  navs: number[],
  tradeCount: number,
  costDragUsd: number,
  periodsPerYear: number,
  intervalMs: number[],
): SegmentMetrics {
  const warnings: string[] = [];
  const points = navs.length;
  const thinSample = points < 30;
  if (thinSample) warnings.push("Sample size < 30 — annualized Sharpe/Sortino/volatility suppressed as unreliable");
  const start = navs[0] ?? 0;
  const end = navs[navs.length - 1] ?? 0;
  const totalReturnPct = start > 0 ? ((end - start) / start) * 100 : 0;
  const rets = simpleReturns(navs);
  const vol = stdevSample(rets);
  const avg = mean(rets);
  let annualizationMismatch = false;
  const medianDtMs = median(intervalMs);
  if (medianDtMs > 0) {
    const impliedPerYear = (365 * 86_400_000) / medianDtMs;
    if (impliedPerYear > 0 && (periodsPerYear / impliedPerYear > 2 || impliedPerYear / periodsPerYear > 2)) {
      annualizationMismatch = true;
      warnings.push(
        `Annualization mismatch — periodsPerYear=${periodsPerYear} but median observation interval implies ~${Math.round(impliedPerYear)}/yr; annualized Sharpe/Sortino/volatility suppressed`,
      );
    }
  }
  if (intervalMs.length > 1 && intervalMs.some((dt) => dt > medianDtMs * 2 || dt * 2 < medianDtMs)) {
    annualizationMismatch = true;
    warnings.push("Irregular observation intervals within segment — annualized Sharpe/Sortino/volatility suppressed");
  }
  let sharpe: number | null = null;
  let sortino: number | null = null;
  let volatilityPctAnn: number | null = vol > 0 ? vol * Math.sqrt(periodsPerYear) * 100 : null;
  if (rets.length >= 5 && vol > 0) {
    sharpe = (avg / vol) * Math.sqrt(periodsPerYear);
  } else {
    warnings.push("Insufficient return observations for Sharpe");
  }
  // Downside deviation over ALL interval returns relative to zero (not sample
  // stdev of the negative-only subset): sqrt(mean(min(r,0)^2)).
  const downside = rets.filter((r) => r < 0);
  const downsideDev =
    rets.length > 0 ? Math.sqrt(rets.reduce((s, r) => s + (r < 0 ? r * r : 0), 0) / rets.length) : 0;
  if (downside.length >= 3 && downsideDev > 0) {
    sortino = (avg / downsideDev) * Math.sqrt(periodsPerYear);
  } else {
    warnings.push("Insufficient downside observations for Sortino");
  }
  if (tradeCount < 10) warnings.push("Fewer than 10 trades in segment — trade-conditioned inference is unreliable");
  if (thinSample || annualizationMismatch) {
    sharpe = null;
    sortino = null;
    volatilityPctAnn = null;
  }
  const positivePeriodRate = rets.length >= 5 ? rets.filter((r) => r > 0).length / rets.length : null;
  return {
    points,
    totalReturnPct,
    maxDrawdownPct: maxDrawdownPct(navs),
    sharpe,
    sortino,
    volatilityPctAnn,
    positivePeriodRate,
    tradeCount,
    costDragUsd,
    warnings,
  };
}

function sliceOf(label: SegmentSlice["label"], rows: ParsedEquity[], start: number, end: number): SegmentSlice {
  const first = rows[start]!;
  const last = rows[end - 1]!;
  return {
    label,
    startIndex: start,
    endIndex: end,
    startTime: first.t,
    endTime: last.t,
    points: end - start,
    spanMs: last.ms - first.ms,
  };
}

export function runValidation(input: ValidationInput): ValidationResult {
  const config = resolveConfig(input.config);
  const equity = parseEquity(input.equity ?? []);
  // Deterministic default clock: last input equity timestamp, or fixed epoch
  // for empty input. Never the wall clock, so replay is deterministic.
  const clockIso = input.clockIso ?? equity[equity.length - 1]?.t ?? "1970-01-01T00:00:00.000Z";
  if (!Number.isFinite(Date.parse(clockIso))) {
    throw new ValidationError("INVALID_CONFIG", "clockIso must be a parseable timestamp");
  }
  const dataSource = input.dataSource ?? "external";
  const digest = digestInputs({ equity: input.equity, trades: input.trades ?? [], benchmark: input.benchmark ?? [], config });
  const provenance: ValidationProvenance = {
    engineVersion: ENGINE_VERSION,
    seed: config.seed,
    config,
    inputDigest: digest,
    dataSource,
    clockIso,
  };

  const emptyResult = (warnings: string[]): ValidationResult => {
    const n = equity.length;
    const nTrain = Math.floor(n * config.split.train);
    const nValid = Math.floor(n * config.split.validation);
    const mk = (label: SegmentSlice["label"], s: number, e: number): SegmentSlice =>
      n > 0 && e > s
        ? sliceOf(label, equity, s, e)
        : {
            label,
            startIndex: s,
            endIndex: e,
            startTime: equity[s]?.t ?? equity[0]?.t ?? clockIso,
            endTime: equity[e - 1]?.t ?? equity[n - 1]?.t ?? clockIso,
            points: Math.max(0, e - s),
            spanMs: 0,
          };
    return {
      status: "INSUFFICIENT_HISTORY",
      warnings,
      segments: {
        train: mk("train", 0, nTrain),
        validation: mk("validation", nTrain, nTrain + nValid),
        oos: mk("oos", nTrain + nValid, n),
      },
      metrics: null,
      benchmark: null,
      benchmarkOmittedReason: "insufficient history — comparison omitted rather than synthesized",
      costSensitivity: null,
      costOmittedReason: "insufficient history — sensitivity omitted",
      latencySensitivity: null,
      latencyOmittedReason: "insufficient history — sensitivity omitted",
      walkForward: null,
      walkForwardOmittedReason: "insufficient history — walk-forward omitted",
      bootstrap: null,
      bootstrapOmittedReason: "insufficient history — bootstrap omitted",
      provenance,
    };
  };

  const n = equity.length;
  // Strict input validation runs BEFORE the sufficiency gate so malformed
  // trades/benchmarks are rejected even on short series — never silently
  // ignored. Range checks need an equity window; with zero equity points any
  // supplied trade is out of range by definition.
  const trades =
    n === 0
      ? (() => {
          if (input.trades !== undefined && input.trades.length > 0) {
            throw new ValidationError(
              "TRADE_OUT_OF_RANGE",
              "trades[0] falls outside the equity observation window (no equity points supplied)",
            );
          }
          return [];
        })()
      : parseTrades(input.trades, equity[0]!.ms, equity[n - 1]!.ms);
  const bench = parseBenchmark(input.benchmark);

  const nTrain = Math.floor(n * config.split.train);
  const nValid = Math.floor(n * config.split.validation);
  const nOos = n - nTrain - nValid;
  // Tiny split fractions can leave a segment with 0-1 points even when total
  // and OOS counts look sufficient; later code dereferences segment endpoints,
  // so fail closed unless every segment has at least 2 points.
  if (n < config.minTotalPoints || nOos < config.minOosPoints || nTrain < 2 || nValid < 2 || nOos < 2) {
    return emptyResult([
      `INSUFFICIENT_HISTORY — ${n} equity points (train ${nTrain} / validation ${nValid} / OOS ${nOos}); need >= ${config.minTotalPoints} total, >= ${config.minOosPoints} OOS, and >= 2 points per segment. Metrics hidden rather than inventing a trajectory.`,
    ]);
  }

  const trainRows = equity.slice(0, nTrain);
  const validRows = equity.slice(nTrain, nTrain + nValid);
  const oosRows = equity.slice(nTrain + nValid);
  const navs = (rows: ParsedEquity[]): number[] => rows.map((r) => r.nav);
  const intervals = (rows: ParsedEquity[]): number[] => rows.slice(1).map((r, i) => r.ms - rows[i]!.ms);
  // Assign a trade between boundary marks to the following segment. Every
  // supplied trade is counted once, including trades in split gaps.
  const tradesIn = (lo: number, hi: number, includeLo: boolean): ParsedTrade[] =>
    trades.filter((r) => (includeLo ? r.ms >= lo : r.ms > lo) && r.ms <= hi);
  const feesIn = (rows: ParsedTrade[]): number => rows.reduce((s, r) => s + r.feeUsd, 0);

  const tTrain = tradesIn(trainRows[0]!.ms, trainRows[trainRows.length - 1]!.ms, true);
  const tValid = tradesIn(trainRows[trainRows.length - 1]!.ms, validRows[validRows.length - 1]!.ms, false);
  const tOos = tradesIn(validRows[validRows.length - 1]!.ms, oosRows[oosRows.length - 1]!.ms, false);

  const warnings: string[] = ["Observational replay — not live profitability. Past segments do not predict OOS."];
  const metrics = {
    train: computeSegmentMetrics(navs(trainRows), tTrain.length, feesIn(tTrain), config.periodsPerYear, intervals(trainRows)),
    validation: computeSegmentMetrics(navs(validRows), tValid.length, feesIn(tValid), config.periodsPerYear, intervals(validRows)),
    oos: computeSegmentMetrics(navs(oosRows), tOos.length, feesIn(tOos), config.periodsPerYear, intervals(oosRows)),
  };

  // Benchmark: only supplied points inside the OOS window; never synthesized or
  // interpolated. Excess compares full-OOS strategy return to the benchmark
  // return between the exact OOS boundary timestamps, so both boundaries must
  // be observed; otherwise the comparison is omitted with a reason.
  let benchmark: BenchmarkComparison | null = null;
  let benchmarkOmittedReason: string | null = null;
  if (bench.length === 0) {
    benchmarkOmittedReason = "no benchmark series supplied — comparison omitted rather than synthesized";
  } else {
    const lo = oosRows[0]!.ms;
    const hi = oosRows[oosRows.length - 1]!.ms;
    const inWindow = bench.filter((b) => b.ms >= lo && b.ms <= hi);
    if (inWindow.length < 2) {
      benchmarkOmittedReason = "benchmark does not cover the OOS window — comparison omitted rather than interpolated";
    } else if (!inWindow.some((b) => b.ms === lo) || !inWindow.some((b) => b.ms === hi)) {
      benchmarkOmittedReason =
        "benchmark does not exactly cover OOS boundaries (missing observation at OOS start and/or end) — comparison omitted rather than interpolated";
    } else {
      const bNavs = inWindow.map((b) => b.value);
      const bStart = inWindow.find((b) => b.ms === lo)!.value;
      const bEnd = inWindow.find((b) => b.ms === hi)!.value;
      benchmark = {
        benchmarkPoints: inWindow.length,
        strategyOosReturnPct: metrics.oos.totalReturnPct,
        benchmarkOosReturnPct: ((bEnd - bStart) / bStart) * 100,
        excessReturnPct: metrics.oos.totalReturnPct - ((bEnd - bStart) / bStart) * 100,
        benchmarkMaxDrawdownPct: maxDrawdownPct(bNavs),
      };
    }
  }

  // Cost / slippage sensitivity: extra drag applied to the observed OOS endpoint.
  let costSensitivity: CostSensitivityRow[] | null = null;
  let costOmittedReason: string | null = null;
  const oosStartNav = oosRows[0]!.nav;
  if (tOos.length === 0) {
    costOmittedReason = "no OOS trades supplied — cost sensitivity omitted rather than modeled from nothing";
  } else {
    const baseFees = feesIn(tOos);
    const oosNotional = tOos.reduce((s, r) => s + r.price * r.qty, 0);
    costSensitivity = config.costScenarios.map((s) => {
      const extraDragUsd = baseFees * (s.feeMultiplier - 1) + oosNotional * (s.extraSlippageBps / 10_000);
      return {
        label: s.label,
        feeMultiplier: s.feeMultiplier,
        extraSlippageBps: s.extraSlippageBps,
        extraDragUsd,
        oosReturnAfterExtraCostsPct: metrics.oos.totalReturnPct - (extraDragUsd / oosStartNav) * 100,
      };
    });
  }

  // Latency sensitivity: hypothetical adverse-move penalty per OOS trade.
  // Never invents fills: penalty is a deterministic function of the supplied
  // OOS notional, so with no OOS trades the table is omitted with a reason.
  let latencySensitivity: LatencySensitivityRow[] | null = null;
  let latencyOmittedReason: string | null = null;
  if (tOos.length === 0) {
    latencyOmittedReason = "no OOS trades supplied — latency sensitivity omitted rather than modeled from nothing";
  } else {
    const oosNotional = tOos.reduce((s, r) => s + r.price * r.qty, 0);
    latencySensitivity = config.latencyStepsMs.map((ms) => {
      const penaltyBps = (ms / 100) * config.latencyBpsPer100ms;
      const extraDragUsd = oosNotional * (penaltyBps / 10_000);
      return {
        label: `+${ms}ms`,
        addedLatencyMs: ms,
        penaltyBps,
        extraDragUsd,
        oosReturnAfterExtraCostsPct: metrics.oos.totalReturnPct - (extraDragUsd / oosStartNav) * 100,
      };
    });
  }

  // Chronological fold summary over the fixed supplied NAV path: expanding
  // windows with evaluation strictly after each boundary. This is NOT model
  // retraining — no fitting occurs; each fold reports the observed NAV return
  // for its test slice.
  let walkForward: WalkForwardFold[] | null = null;
  let walkForwardOmittedReason: string | null = null;
  if (config.walkForwardFolds < 2) {
    walkForwardOmittedReason = "walk-forward disabled (folds < 2)";
  } else if (n < config.minTotalPoints + config.walkForwardFolds) {
    walkForwardOmittedReason = "insufficient history for honest walk-forward folds — omitted";
  } else {
    const folds: WalkForwardFold[] = [];
    const evalRegionStart = nTrain;
    for (let f = 0; f < config.walkForwardFolds; f++) {
      const trainEnd = evalRegionStart + Math.floor(((n - evalRegionStart) * (f + 1)) / (config.walkForwardFolds + 1));
      const testStart = trainEnd;
      const testEnd = f === config.walkForwardFolds - 1 ? n : evalRegionStart + Math.floor(((n - evalRegionStart) * (f + 2)) / (config.walkForwardFolds + 1));
      if (testEnd - testStart < 2 || trainEnd <= 0) continue;
      const a = equity[testStart]!.nav;
      const b = equity[testEnd - 1]!.nav;
      folds.push({
        fold: f,
        trainEndIndex: trainEnd,
        testStartIndex: testStart,
        testEndIndex: testEnd,
        testReturnPct: ((b - a) / a) * 100,
      });
    }
    if (folds.length >= 2) {
      walkForward = folds;
    } else {
      walkForwardOmittedReason = "insufficient history for honest walk-forward folds — omitted";
    }
  }

  // Seeded bootstrap over OOS simple returns (honest only with enough observations).
  let bootstrap: BootstrapSummary | null = null;
  let bootstrapOmittedReason: string | null = null;
  const oosRets = simpleReturns(navs(oosRows));
  if (config.bootstrapSamples === 0) {
    bootstrapOmittedReason = "bootstrap disabled (samples = 0)";
  } else if (oosRets.length < 10) {
    bootstrapOmittedReason = "insufficient OOS returns for honest bootstrap — omitted";
  } else {
    const rand = mulberry32(config.seed);
    const totals: number[] = [];
    for (let b = 0; b < config.bootstrapSamples; b++) {
      let compounded = 1;
      for (let i = 0; i < oosRets.length; i++) {
        compounded *= 1 + (oosRets[Math.floor(rand() * oosRets.length)] ?? 0);
      }
      totals.push((compounded - 1) * 100);
    }
    totals.sort((a, b2) => a - b2);
    const q = (p: number): number => totals[Math.min(totals.length - 1, Math.floor(p * totals.length))] ?? 0;
    bootstrap = {
      samples: config.bootstrapSamples,
      meanTotalReturnPct: mean(totals),
      p5TotalReturnPct: q(0.05),
      p50TotalReturnPct: q(0.5),
      p95TotalReturnPct: q(0.95),
    };
  }

  return {
    status: "OK",
    warnings,
    segments: {
      train: sliceOf("train", equity, 0, nTrain),
      validation: sliceOf("validation", equity, nTrain, nTrain + nValid),
      oos: sliceOf("oos", equity, nTrain + nValid, n),
    },
    metrics,
    benchmark,
    benchmarkOmittedReason,
    costSensitivity,
    costOmittedReason,
    latencySensitivity,
    latencyOmittedReason,
    walkForward,
    walkForwardOmittedReason,
    bootstrap,
    bootstrapOmittedReason,
    provenance,
  };
}
