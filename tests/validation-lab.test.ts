import { describe, it, expect } from "vitest";
import {
  runValidation,
  resolveConfig,
  digestInputs,
  mulberry32,
  ValidationError,
  ENGINE_VERSION,
  type EquityObservation,
  type TradeObservation,
  type BenchmarkObservation,
} from "../packages/validation-lab/src/index";

const CLOCK = "2026-09-24T00:00:00.000Z";
const DAY = 86_400_000;
const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();

function equitySeries(n: number, startNav = 1000, step = 1, startMs = T0, stepMs = DAY): EquityObservation[] {
  return Array.from({ length: n }, (_, i) => ({
    t: iso(startMs + i * stepMs),
    nav: startNav + i * step,
  }));
}

/** Trades placed on days inside the OOS window (last 20% of the series). */
function oosTrades(equity: EquityObservation[], feeUsd = 1): TradeObservation[] {
  const start = equity.length - 10;
  return equity.slice(start, start + 8).map((p, i) => ({
    t: p.t,
    side: (i % 2 === 0 ? "BUY" : "SELL") as "BUY" | "SELL",
    price: 100,
    qty: 1,
    feeUsd,
  }));
}

function oosBenchmark(equity: EquityObservation[], start = 500, step = 0.5): BenchmarkObservation[] {
  return equity.slice(equity.length - 10).map((p, i) => ({ t: p.t, value: start + i * step }));
}

describe("validation-lab insufficient history", () => {
  it("returns INSUFFICIENT_HISTORY with metrics hidden on short series", () => {
    const r = runValidation({ equity: equitySeries(10), clockIso: CLOCK });
    expect(r.status).toBe("INSUFFICIENT_HISTORY");
    expect(r.metrics).toBeNull();
    expect(r.benchmark).toBeNull();
    expect(r.costSensitivity).toBeNull();
    expect(r.latencySensitivity).toBeNull();
    expect(r.walkForward).toBeNull();
    expect(r.bootstrap).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/INSUFFICIENT_HISTORY/);
    expect(r.benchmarkOmittedReason).toBeTruthy();
    expect(r.costOmittedReason).toBeTruthy();
    expect(r.latencyOmittedReason).toBeTruthy();
    expect(r.walkForwardOmittedReason).toBeTruthy();
    expect(r.bootstrapOmittedReason).toBeTruthy();
    // Segments still reported (machine-readable shape) but no performance invented.
    expect(r.segments.oos.points).toBeLessThan(10);
    expect(r.provenance.engineVersion).toBe(ENGINE_VERSION);
    expect(r.provenance.clockIso).toBe(CLOCK);
  });

  it("rejects malformed trades even when history is insufficient", () => {
    const eq = equitySeries(5);
    expect(() =>
      runValidation({
        equity: eq,
        trades: [{ t: iso(T0 - DAY), side: "BUY", price: 1, qty: 1 }],
        clockIso: CLOCK,
      }),
    ).toThrowError(ValidationError);
  });

  it("empty equity yields INSUFFICIENT_HISTORY, never a trajectory", () => {
    const r = runValidation({ equity: [], clockIso: CLOCK });
    expect(r.status).toBe("INSUFFICIENT_HISTORY");
    expect(r.metrics).toBeNull();
  });
});

describe("validation-lab timestamp / causality checks", () => {
  it("rejects non-monotonic equity timestamps (leakage guard)", () => {
    const eq = equitySeries(40);
    const tmp = eq[10]!;
    eq[10] = eq[11]!;
    eq[11] = tmp;
    expect(() => runValidation({ equity: eq, clockIso: CLOCK })).toThrowError(/NON_MONOTONIC_TIMESTAMPS/);
  });

  it("rejects duplicate equity timestamps", () => {
    const eq = equitySeries(40);
    eq[11] = { ...eq[10]! };
    expect(() => runValidation({ equity: eq, clockIso: CLOCK })).toThrowError(/DUPLICATE_TIMESTAMP/);
  });

  it("rejects unparseable timestamps", () => {
    const eq = equitySeries(40);
    eq[5] = { t: "not-a-time", nav: 100 };
    expect(() => runValidation({ equity: eq, clockIso: CLOCK })).toThrowError(/BAD_TIMESTAMP/);
  });

  it("rejects trades outside the equity window and duplicate trade timestamps", () => {
    const eq = equitySeries(50);
    expect(() =>
      runValidation({
        equity: eq,
        trades: [{ t: iso(T0 + 100 * DAY), side: "BUY", price: 1, qty: 1 }],
        clockIso: CLOCK,
      }),
    ).toThrowError(/TRADE_OUT_OF_RANGE/);

    const dup: TradeObservation[] = [
      { t: eq[41]!.t, side: "BUY", price: 100, qty: 1 },
      { t: eq[41]!.t, side: "SELL", price: 100, qty: 1 },
    ];
    expect(() => runValidation({ equity: eq, trades: dup, clockIso: CLOCK })).toThrowError(/DUPLICATE/);
  });

  it("partitions train/validation/oos without overlap and in time order", () => {
    const eq = equitySeries(50);
    const r = runValidation({ equity: eq, trades: oosTrades(eq), clockIso: CLOCK });
    expect(r.status).toBe("OK");
    const { train, validation, oos } = r.segments;
    expect(train.endIndex).toBe(validation.startIndex);
    expect(validation.endIndex).toBe(oos.startIndex);
    expect(oos.endIndex).toBe(50);
    expect(Date.parse(train.endTime)).toBeLessThan(Date.parse(validation.startTime));
    expect(Date.parse(validation.endTime)).toBeLessThan(Date.parse(oos.startTime));
    expect(train.points + validation.points + oos.points).toBe(50);
  });

  it("walk-forward folds evaluate strictly after each train boundary", () => {
    const eq = equitySeries(60);
    const r = runValidation({ equity: eq, trades: oosTrades(eq), clockIso: CLOCK });
    expect(r.walkForward).not.toBeNull();
    for (const f of r.walkForward!) {
      expect(f.testStartIndex).toBe(f.trainEndIndex);
      expect(f.testEndIndex).toBeGreaterThan(f.testStartIndex);
    }
  });
});

describe("validation-lab benchmark baseline", () => {
  it("compares supplied OOS benchmark without synthesis", () => {
    const eq = equitySeries(50);
    const r = runValidation({ equity: eq, trades: oosTrades(eq), benchmark: oosBenchmark(eq), clockIso: CLOCK });
    expect(r.benchmark).not.toBeNull();
    expect(r.benchmarkOmittedReason).toBeNull();
    // Strategy OOS: nav 1040 -> 1049 = +0.8653…%; benchmark 500 -> 504.5 = +0.9%.
    expect(r.benchmark!.benchmarkPoints).toBe(10);
    expect(r.benchmark!.strategyOosReturnPct).toBeCloseTo((9 / 1040) * 100, 10);
    expect(r.benchmark!.benchmarkOosReturnPct).toBeCloseTo(0.9, 10);
    expect(r.benchmark!.excessReturnPct).toBeCloseTo((9 / 1040) * 100 - 0.9, 10);
  });

  it("omits benchmark with a reason when none supplied or out of OOS window", () => {
    const eq = equitySeries(50);
    const none = runValidation({ equity: eq, trades: oosTrades(eq), clockIso: CLOCK });
    expect(none.benchmark).toBeNull();
    expect(none.benchmarkOmittedReason).toMatch(/no benchmark series/);

    const trainOnly = runValidation({
      equity: eq,
      trades: oosTrades(eq),
      benchmark: eq.slice(0, 10).map((p, i) => ({ t: p.t, value: 100 + i })),
      clockIso: CLOCK,
    });
    expect(trainOnly.benchmark).toBeNull();
    expect(trainOnly.benchmarkOmittedReason).toMatch(/OOS window/);
  });
});

describe("validation-lab fees / cost sensitivity", () => {
  it("counts boundary-gap trades exactly once in the following segment", () => {
    const eq = equitySeries(50);
    const trade = { t: iso(Date.parse(eq[29]!.t) + 3_600_000), side: "BUY" as const, price: 100, qty: 2, feeUsd: 50 };
    const r = runValidation({ equity: eq, trades: [trade], clockIso: CLOCK });
    expect(r.metrics!.train.tradeCount).toBe(0);
    expect(r.metrics!.validation.tradeCount).toBe(1);
    expect(r.metrics!.validation.costDragUsd).toBe(50);
  });

  it("rejects scenarios that could improve an observed return", () => {
    expect(() => resolveConfig({ costScenarios: [{ label: "free", feeMultiplier: 0, extraSlippageBps: 0 }] })).toThrowError(/INVALID_CONFIG/);
    expect(() => resolveConfig({ latencyStepsMs: [-100] })).toThrowError(/INVALID_CONFIG/);
    expect(() => resolveConfig({ latencyBpsPer100ms: -1 })).toThrowError(/INVALID_CONFIG/);
  });
  it("scales fee drag and slippage deterministically from supplied OOS trades", () => {
    const eq = equitySeries(50);
    const trades = oosTrades(eq, 1); // 8 trades x $1 fee = $8 base
    const r = runValidation({ equity: eq, trades, clockIso: CLOCK });
    expect(r.costSensitivity).not.toBeNull();
    expect(r.latencySensitivity).not.toBeNull();
    expect(r.costOmittedReason).toBeNull();
    const byLabel = Object.fromEntries(r.costSensitivity!.map((x) => [x.label, x]));
    expect(byLabel["base"]!.extraDragUsd).toBeCloseTo(0, 10);
    expect(byLabel["fees-x2"]!.extraDragUsd).toBeCloseTo(8, 10); // baseFees * (2-1)
    // 8 trades x $100 notional = $800; 50bps -> $4.
    expect(byLabel["slip-50bps"]!.extraDragUsd).toBeCloseTo(4, 10);
    // Net OOS return falls as drag rises.
    expect(byLabel["fees-x2"]!.oosReturnAfterExtraCostsPct).toBeLessThan(byLabel["base"]!.oosReturnAfterExtraCostsPct);
    expect(r.metrics!.oos.costDragUsd).toBeCloseTo(8, 10);
  });

  it("omits cost/latency tables with reasons when no OOS trades exist", () => {
    const eq = equitySeries(50);
    const r = runValidation({ equity: eq, clockIso: CLOCK });
    expect(r.status).toBe("OK");
    expect(r.costSensitivity).toBeNull();
    expect(r.costOmittedReason).toMatch(/no OOS trades/);
    expect(r.latencySensitivity).toBeNull();
    expect(r.latencyOmittedReason).toMatch(/no OOS trades/);
  });

  it("latency +0ms row carries zero drag and matches gross OOS return", () => {
    const eq = equitySeries(50);
    const r = runValidation({ equity: eq, trades: oosTrades(eq), clockIso: CLOCK });
    const zero = r.latencySensitivity!.find((x) => x.addedLatencyMs === 0)!;
    expect(zero.extraDragUsd).toBe(0);
    expect(zero.oosReturnAfterExtraCostsPct).toBeCloseTo(r.metrics!.oos.totalReturnPct, 12);
    const slow = r.latencySensitivity!.find((x) => x.addedLatencyMs === 500)!;
    expect(slow.penaltyBps).toBeCloseTo(25, 10);
    expect(slow.oosReturnAfterExtraCostsPct).toBeLessThan(zero.oosReturnAfterExtraCostsPct);
  });
});

describe("validation-lab determinism and provenance", () => {
  it("replays deterministically: identical input + clock => identical output", () => {
    const eq = equitySeries(50);
    const mkInput = () => ({
      equity: eq,
      trades: oosTrades(eq),
      benchmark: oosBenchmark(eq),
      clockIso: CLOCK,
      dataSource: "unit-test",
    });
    const a = runValidation(mkInput());
    const b = runValidation(mkInput());
    expect(b).toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a); // machine-readable / JSON-safe
    expect(a.provenance.inputDigest).toBe(digestInputs({
      equity: eq,
      trades: oosTrades(eq),
      benchmark: oosBenchmark(eq),
      config: a.provenance.config,
    }));
    expect(a.provenance.dataSource).toBe("unit-test");
  });

  it("seeded bootstrap is reproducible and seed-sensitive", () => {
    const eq = equitySeries(60);
    const base = { equity: eq, trades: oosTrades(eq), clockIso: CLOCK };
    const a = runValidation({ ...base, config: { seed: 7 } });
    const b = runValidation({ ...base, config: { seed: 7 } });
    expect(a.bootstrap).toEqual(b.bootstrap);
    const c = runValidation({ ...base, config: { seed: 8 } });
    expect(c.provenance.seed).toBe(8);
    expect(c.bootstrap).not.toEqual(a.bootstrap);
  });

  it("mulberry32 is deterministic per seed", () => {
    const run = (seed: number): number[] => {
      const r = mulberry32(seed);
      return [r(), r(), r()];
    };
    expect(run(7)).toEqual(run(7));
    expect(run(8)).not.toEqual(run(7));
  });

  it("sample-size and annualization suppress annualized ratios with warnings", () => {
    // Default daily-ish cadence vs periodsPerYear=252 is consistent.
    // Train has 30 points so ratios are reported; OOS has 10 points so
    // annualized Sharpe/Sortino/volatility are suppressed (null).
    const eq = equitySeries(50);
    const ok = runValidation({ equity: eq, trades: oosTrades(eq), clockIso: CLOCK });
    expect(ok.metrics!.train.sharpe).not.toBeNull();
    expect(ok.metrics!.train.sortino).toBeNull(); // monotonic rise => no downside
    expect(ok.metrics!.train.volatilityPctAnn).not.toBeNull();
    expect(ok.metrics!.oos.sharpe).toBeNull();
    expect(ok.metrics!.oos.sortino).toBeNull();
    expect(ok.metrics!.oos.volatilityPctAnn).toBeNull();
    expect(ok.metrics!.oos.warnings.join(" ")).toMatch(/< 30/);

    // Hourly observations against periodsPerYear=252 must flag annualization
    // mismatch and suppress annualized ratios even on the 30-point train slice.
    const hourly = equitySeries(50, 1000, 1, T0, 3_600_000);
    const mismatched = runValidation({ equity: hourly, trades: oosTrades(hourly), clockIso: CLOCK });
    const all = [
      ...mismatched.metrics!.train.warnings,
      ...mismatched.metrics!.validation.warnings,
      ...mismatched.metrics!.oos.warnings,
    ].join(" ");
    expect(all).toMatch(/Annualization mismatch/);
    expect(mismatched.metrics!.train.sharpe).toBeNull();
    expect(mismatched.metrics!.train.sortino).toBeNull();
    expect(mismatched.metrics!.train.volatilityPctAnn).toBeNull();
    expect(mismatched.metrics!.oos.sharpe).toBeNull();
  });

  it("uses each segment's cadence and suppresses irregular intervals", () => {
    const daily = equitySeries(120);
    const hourly = Array.from({ length: 30 }, (_, i) => ({
      t: iso(Date.parse(daily[119]!.t) + (i + 1) * 3_600_000),
      nav: 1120 + i,
    }));
    const r = runValidation({ equity: [...daily, ...hourly], clockIso: CLOCK });
    expect(r.metrics!.oos.warnings.join(" ")).toMatch(/Annualization mismatch/);
    expect(r.metrics!.oos.sharpe).toBeNull();
    const irregular = equitySeries(60);
    for (let i = 40; i < irregular.length; i++) irregular[i] = { ...irregular[i]!, t: iso(Date.parse(irregular[i]!.t) + 10 * DAY) };
    const ir = runValidation({ equity: irregular, clockIso: CLOCK });
    expect(ir.metrics!.validation.warnings.join(" ")).toMatch(/Irregular observation intervals/);
    expect(ir.metrics!.validation.sharpe).toBeNull();
  });

  it("rejects invalid split and config", () => {
    expect(() => resolveConfig({ split: { train: 0.5, validation: 0.5, oos: 0.5 } })).toThrowError(/INVALID_SPLIT/);
    expect(() => resolveConfig({ minTotalPoints: 2 })).toThrowError(/INVALID_CONFIG/);
  });
});

describe("validation-lab adversarial fixes", () => {
  it("tiny splits fail closed with INSUFFICIENT_HISTORY and null metrics", () => {
    const eq = equitySeries(50);
    const thin = runValidation({
      equity: eq,
      clockIso: CLOCK,
      config: { split: { train: 0.02, validation: 0.02, oos: 0.96 } },
    });
    expect(thin.status).toBe("INSUFFICIENT_HISTORY");
    expect(thin.metrics).toBeNull();
    expect(thin.warnings.join(" ")).toMatch(/INSUFFICIENT_HISTORY/);

    const zeroTrain = runValidation({
      equity: eq,
      clockIso: CLOCK,
      config: { split: { train: 0.01, validation: 0.49, oos: 0.5 } },
    });
    expect(zeroTrain.status).toBe("INSUFFICIENT_HISTORY");
    expect(zeroTrain.metrics).toBeNull();
    expect(zeroTrain.segments.train.points).toBeLessThan(2);
  });

  it("omits benchmark when OOS boundary observations are missing", () => {
    const eq = equitySeries(50);
    const full = oosBenchmark(eq);
    const late = runValidation({ equity: eq, trades: oosTrades(eq), benchmark: full.slice(1), clockIso: CLOCK });
    expect(late.benchmark).toBeNull();
    expect(late.benchmarkOmittedReason).toMatch(/boundar/);
    const early = runValidation({
      equity: eq,
      trades: oosTrades(eq),
      benchmark: full.slice(0, -1),
      clockIso: CLOCK,
    });
    expect(early.benchmark).toBeNull();
    expect(early.benchmarkOmittedReason).toMatch(/boundar/);
  });

  it("reports positivePeriodRate for intervals, never a trade win rate", () => {
    const eq = equitySeries(150);
    const r = runValidation({ equity: eq, trades: oosTrades(eq), clockIso: CLOCK });
    expect(r.status).toBe("OK");
    // Monotonic rise: every interval return is positive.
    expect(r.metrics!.oos.positivePeriodRate).toBeCloseTo(1, 12);
    expect((r.metrics!.oos as unknown as Record<string, unknown>)["hitRate"]).toBeUndefined();
  });

  it("sortino uses downside deviation over all returns relative to zero", () => {
    const eq: EquityObservation[] = [];
    let nav = 1000;
    for (let i = 0; i < 150; i++) {
      eq.push({ t: iso(T0 + i * DAY), nav });
      nav += i % 2 === 0 ? 10 : -6;
    }
    const r = runValidation({ equity: eq, clockIso: CLOCK });
    expect(r.status).toBe("OK");
    const nTrain = Math.floor(150 * 0.6);
    const trainNavs = eq.slice(0, nTrain).map((p) => p.nav);
    const rets = trainNavs.slice(1).map((v, i) => (v - trainNavs[i]!) / trainNavs[i]!);
    const avg = rets.reduce((a, b) => a + b, 0) / rets.length;
    const downsideDev = Math.sqrt(rets.reduce((s, x) => s + (x < 0 ? x * x : 0), 0) / rets.length);
    const expected = (avg / downsideDev) * Math.sqrt(252);
    expect(r.metrics!.train.sortino).not.toBeNull();
    expect(r.metrics!.train.sortino!).toBeCloseTo(expected, 10);
    // The old negative-only sample-stdev denominator gives a different value.
    const neg = rets.filter((x) => x < 0);
    const m = neg.reduce((a, b) => a + b, 0) / neg.length;
    const oldStd = Math.sqrt(neg.reduce((s, x) => s + (x - m) ** 2, 0) / (neg.length - 1));
    const oldSortino = (avg / oldStd) * Math.sqrt(252);
    expect(Math.abs(expected - oldSortino)).toBeGreaterThan(1e-6);
  });

  it("defaults clock deterministically from input, never the wall clock", () => {
    const eq = equitySeries(50);
    const a = runValidation({ equity: eq });
    const b = runValidation({ equity: eq });
    expect(a.provenance.clockIso).toBe(eq[eq.length - 1]!.t);
    expect(b).toEqual(a);
    const empty = runValidation({ equity: [] });
    expect(empty.provenance.clockIso).toBe("1970-01-01T00:00:00.000Z");
    expect(runValidation({ equity: [] })).toEqual(empty);
  });

  it("walk-forward folds are a chronological NAV summary, not retraining", () => {
    const eq = equitySeries(60);
    const r = runValidation({ equity: eq, trades: oosTrades(eq), clockIso: CLOCK });
    expect(r.walkForward).not.toBeNull();
    for (const f of r.walkForward!) {
      const a = eq[f.testStartIndex]!.nav;
      const b = eq[f.testEndIndex - 1]!.nav;
      expect(f.testReturnPct).toBeCloseTo(((b - a) / a) * 100, 12);
    }
  });
});
