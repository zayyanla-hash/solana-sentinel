import { describe, it, expect } from "vitest";
import { OhlcvBarSchema } from "@sat/shared";
import {
  computeHistoricalMomentum,
  computeHistoricalRelativeStrength,
  computeHistoricalVolume,
  computeTrendBreakout,
  barsAsOf,
  closedBars,
  simpleReturnPct,
  SIGNAL_MIN_HISTORY,
  type HistoricalBars,
} from "@sat/signals";
import { buildDemoOhlcv } from "@sat/market-data";

function bar(ts: number, close: number, volume = 1000): ReturnType<typeof OhlcvBarSchema.parse> {
  return OhlcvBarSchema.parse({
    timestamp: ts,
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume,
  });
}

describe("historical OHLCV signals", () => {
  const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);

  it("Zod rejects invalid provider bars", () => {
    expect(OhlcvBarSchema.safeParse({ timestamp: 1, open: 1, high: 0.5, low: 1, close: 1, volume: 1 }).success).toBe(
      false,
    );
  });

  it("computes 5m/15m/1h momentum and acceleration from fixtures", () => {
    const five = [bar(t0, 100), bar(t0 + 300_000, 102), bar(t0 + 600_000, 106)];
    const fifteen = [bar(t0, 100), bar(t0 + 900_000, 104)];
    const hourly = [bar(t0, 100), bar(t0 + 3_600_000, 101)];
    const s = computeHistoricalMomentum({ "5m": five, "15m": fifteen, "1h": hourly });
    expect(s.meta?.insufficientData).toBeFalsy();
    expect(s.meta?.return5mPct).toBeCloseTo(((106 - 102) / 102) * 100, 5);
    expect(s.meta?.acceleration5m).toBeCloseTo(
      ((106 - 102) / 102) * 100 - ((102 - 100) / 100) * 100,
      5,
    );
    expect(s.confidence).toBeGreaterThan(0.5);
  });

  it("volume uses a 20-bar baseline and relative volume", () => {
    const bars = Array.from({ length: 21 }, (_, i) =>
      bar(t0 + i * 300_000, 10, i === 20 ? 5000 : 1000),
    );
    const s = computeHistoricalVolume({ "5m": bars });
    expect(s.meta?.relativeVolume).toBeCloseTo(5, 5);
    expect(s.meta?.baselineVolume).toBeCloseTo(1000, 5);
  });

  it("missing history returns INSUFFICIENT_DATA and does not invent bars", () => {
    const s = computeHistoricalMomentum({ "5m": [bar(t0, 100)] });
    expect(s.meta?.insufficientData).toBe(true);
    expect(s.meta?.reason).toBe("INSUFFICIENT_DATA");
    expect(s.confidence).toBeLessThan(0.2);
  });

  it("relative strength uses SOL bars, never a hardcoded +2% benchmark", () => {
    const token = [bar(t0, 10), bar(t0 + 300_000, 11)];
    const sol = [bar(t0, 100), bar(t0 + 300_000, 101)];
    const s = computeHistoricalRelativeStrength({ "5m": token, sol: { "5m": sol } });
    expect(s.meta?.hardcodedBenchmark).toBe(false);
    expect(s.value).toBeCloseTo(((11 - 10) / 10) * 100 - ((101 - 100) / 100) * 100, 5);
    const missing = computeHistoricalRelativeStrength({ "5m": token });
    expect(missing.meta?.reason).toMatch(/NO_BENCHMARK|INSUFFICIENT_DATA/);
    expect(missing.value).toBe(0);
    expect(missing.meta?.hardcodedBenchmark).toBe(false);
    expect(missing.meta?.haveSolBars).toBe(0);
  });

  it("drops in-progress bars (closed-bar alignment)", () => {
    const intervalMs = 300_000;
    const lastOpen = t0 + intervalMs;
    const bars = [bar(t0, 100), bar(lastOpen, 110)];
    const asOf = lastOpen + 1;
    const { bars: closed, barsDropped } = closedBars(bars, "5m", asOf);
    expect(closed).toHaveLength(1);
    expect(closed[0]?.close).toBe(100);
    expect(barsDropped).toBe(1);
  });

  it("ignores future bars (no lookahead)", () => {
    const bars = [bar(t0, 100), bar(t0 + 300_000, 110), bar(t0 + 600_000, 200)];
    const asOf = barsAsOf(bars, t0 + 300_000);
    expect(asOf).toHaveLength(2);
    expect(simpleReturnPct(asOf)).toBeCloseTo(10, 5);
  });

  it("trend/breakout uses rolling highs without inventing missing 1h history", () => {
    const hourly = Array.from({ length: 20 }, (_, i) =>
      bar(t0 + i * 3_600_000, 100 + i, 10),
    );
    const last = hourly[hourly.length - 1]!;
    hourly[hourly.length - 1] = {
      ...last,
      close: 200,
      high: 200,
    };
    const s = computeTrendBreakout({ "1h": hourly });
    expect(s.meta?.insufficientData).toBeFalsy();
    expect((s.meta?.breakoutDistance as number) > 0).toBe(true);
    const short = computeTrendBreakout({ "5m": [bar(t0, 1)] });
    expect(short.meta?.insufficientData).toBe(true);
  });

  it("demo OHLCV builder is deterministic for a mint/time", () => {
    const a = buildDemoOhlcv({
      mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
      lastClose: 0.72,
      interval: "5m",
      count: 30,
      endMs: t0,
    });
    const b = buildDemoOhlcv({
      mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
      lastClose: 0.72,
      interval: "5m",
      count: 30,
      endMs: t0,
    });
    expect(a).toEqual(b);
    expect(a).toHaveLength(30);
    expect(SIGNAL_MIN_HISTORY.momentum5mReturn.bars).toBe(2);
  });
});

describe("historical bars helper types", () => {
  it("HistoricalBars is interval-keyed", () => {
    const h: HistoricalBars = { "5m": [] };
    expect(h["5m"]).toEqual([]);
  });
});
