import {
  type OhlcvBar,
  type StrategyLabConfig,
  type BacktestResult,
  type BacktestTrade,
  DEFAULT_STRATEGY_LAB_CONFIG,
  BacktestResultSchema,
  newId,
  nowIso,
} from "@sat/shared";
import { computePerformance } from "@sat/analytics";

export const BACKTEST_ENGINE_VERSION = "backtest-v1";

export interface BacktestMarket {
  mint: string;
  bars: OhlcvBar[];
  liquidityUsd?: number | null;
  tokenAgeHours?: number | null;
  tokenRiskScore?: number | null;
  confirmingWallets?: number;
  walletCredibility?: number;
}

function costsUsd(notional: number, impactBps: number, feeUsd: number): number {
  return notional * ((8 + 12 + impactBps) / 10_000) + feeUsd;
}

function impactBps(notional: number, liquidity: number | null | undefined): number {
  const liq = liquidity && liquidity > 0 ? liquidity : 250_000;
  return Math.min(250, 15 * Math.sqrt(Math.max(notional, 1) / liq) * 100);
}

/**
 * Bar-by-bar paper backtest.
 * Signals at bar i use only closed bars [0..i]. Fills at bar i+1 open.
 * Never uses future closes. Metrics hidden below 10 trades / 30 equity points.
 */
export function runBacktest(params: {
  markets: BacktestMarket[];
  config?: StrategyLabConfig;
  startingCapital?: number;
  benchmark?: OhlcvBar[];
  isDemo?: boolean;
  walkForward?: boolean;
}): BacktestResult {
  const config = params.config ?? DEFAULT_STRATEGY_LAB_CONFIG;
  const startCash = params.startingCapital ?? 100_000;
  const isDemo = params.isDemo ?? true;
  const warnings: string[] = [];

  const primary = params.markets[0];
  if (!primary || primary.bars.length < 8) {
    return BacktestResultSchema.parse({
      id: newId(),
      strategyVersion: config.version,
      datasetVersion: config.datasetVersion,
      config,
      equity: [startCash],
      benchmarkEquity: [startCash],
      trades: [],
      metrics: null,
      warnings: ["INSUFFICIENT_HISTORY — need at least 8 bars"],
      dataCoverage: { bars: primary?.bars.length ?? 0, interval: "unknown", startMs: null, endMs: null },
      walkForward: null,
      isDemo,
      label: isDemo ? "DEMO" : "BACKTEST",
      createdAt: nowIso(),
    });
  }

  const bars = [...primary.bars].sort((a, b) => a.timestamp - b.timestamp);
  const fillLag = 1;
  let cash = startCash;
  let qty = 0;
  let entry = 0;
  let entryBar = -1;
  let cooldownUntil = -1;
  let peak = startCash;
  const equity: number[] = [];
  const trades: BacktestTrade[] = [];
  const failed: string[] = [];

  const momentumAt = (i: number): number => {
    const prev = bars[i - 1];
    const cur = bars[i];
    if (!prev || !cur || prev.close <= 0) return 0;
    return (cur.close - prev.close) / prev.close;
  };
  const volAt = (i: number): number => {
    const window = bars.slice(Math.max(0, i - 12), i + 1);
    if (window.length < 4) return 0;
    const rets: number[] = [];
    for (let k = 1; k < window.length; k++) {
      const p = window[k - 1]!.close;
      if (p > 0) rets.push((window[k]!.close - p) / p);
    }
    if (rets.length < 2) return 0;
    const m = rets.reduce((s, x) => s + x, 0) / rets.length;
    return Math.sqrt(rets.reduce((s, x) => s + (x - m) ** 2, 0) / (rets.length - 1));
  };
  const volumeAccel = (i: number): number => {
    const cur = bars[i]!.volume;
    const prev = bars.slice(Math.max(0, i - 20), i);
    if (!prev.length) return 0;
    const avg = prev.reduce((s, b) => s + b.volume, 0) / prev.length;
    return avg > 0 ? (cur - avg) / avg : 0;
  };

  const canEnter = (i: number): { ok: boolean; reason: string } => {
    if ((primary.liquidityUsd ?? 1_000_000) < config.liquidityFloorUsd) {
      return { ok: false, reason: "liquidity floor" };
    }
    if ((primary.tokenAgeHours ?? 10_000) < config.minTokenAgeHours) {
      return { ok: false, reason: "token age" };
    }
    if ((primary.tokenRiskScore ?? 20) > config.maxTokenRiskScore) {
      return { ok: false, reason: "token-risk ceiling" };
    }
    if ((primary.walletCredibility ?? 70) < config.minWalletCredibility) {
      return { ok: false, reason: "wallet credibility" };
    }
    if ((primary.confirmingWallets ?? 2) < config.minConfirmingWallets) {
      return { ok: false, reason: "confirming wallets" };
    }
    if (momentumAt(i) < config.momentumThreshold) return { ok: false, reason: "momentum" };
    if (volumeAccel(i) < config.volumeThreshold) return { ok: false, reason: "volume" };
    if (volAt(i) > config.maxVolatility) return { ok: false, reason: "volatility" };
    const exposure = (qty * bars[i]!.close) / Math.max(cash + qty * bars[i]!.close, 1);
    if (exposure >= config.maxPortfolioExposurePct) return { ok: false, reason: "exposure" };
    return { ok: true, reason: "entry" };
  };

  const trainEnd = params.walkForward ? Math.floor(bars.length * 0.6) : 0;
  const validEnd = params.walkForward ? Math.floor(bars.length * 0.8) : 0;
  let oosStartNav: number | null = null;
  let oosEndNav: number | null = null;

  for (let i = 2; i < bars.length; i++) {
    const mark = bars[i]!.close;
    const nav = cash + qty * mark;
    peak = Math.max(peak, nav);
    equity.push(nav);
    if (params.walkForward && i === validEnd) oosStartNav = nav;
    if (params.walkForward && i === bars.length - 1) oosEndNav = nav;

    const fillBar = bars[i];
    if (!fillBar) continue;

    if (qty > 0) {
      const hold = i - entryBar;
      const ret = entry > 0 ? (mark - entry) / entry : 0;
      const ddFromEntry = entry > 0 ? (entry - mark) / entry : 0;
      let exitReason: string | null = null;
      if (ddFromEntry >= config.stopLossPct) exitReason = "stop-loss";
      else if (ret >= config.takeProfitPct) exitReason = "take-profit";
      else if (config.trailingExitPct != null && peak > 0 && (peak - nav) / peak >= config.trailingExitPct) {
        exitReason = "trailing-exit";
      } else if (hold >= config.maxHoldingBars) exitReason = "max-hold";
      if (exitReason) {
        const fillPx = bars[Math.min(i + fillLag, bars.length - 1)]!.open;
        const usd = qty * fillPx;
        const c = costsUsd(usd, impactBps(usd, primary.liquidityUsd), 0.02);
        cash += usd - c;
        trades.push({
          mint: primary.mint,
          side: "SELL",
          barIndex: i + fillLag,
          timestamp: fillBar.timestamp,
          price: fillPx,
          qty,
          usd,
          reason: exitReason,
          costsUsd: c,
        });
        qty = 0;
        entry = 0;
        cooldownUntil = i + config.cooldownBars;
      }
    } else if (i >= cooldownUntil && i + fillLag < bars.length) {
      if (params.walkForward && i < trainEnd) {
        continue;
      }
      const gate = canEnter(i);
      if (gate.ok) {
        const fillPx = bars[i + fillLag]!.open;
        if (!(fillPx > 0)) {
          failed.push("impossible fill — non-positive open");
          continue;
        }
        const usd = Math.min(config.positionSizeUsd, cash * 0.95);
        if (usd < 50) continue;
        const c = costsUsd(usd, impactBps(usd, primary.liquidityUsd), 0.02);
        const buyQty = (usd - c) / fillPx;
        cash -= usd;
        qty = buyQty;
        entry = fillPx;
        entryBar = i;
        trades.push({
          mint: primary.mint,
          side: "BUY",
          barIndex: i + fillLag,
          timestamp: bars[i + fillLag]!.timestamp,
          price: fillPx,
          qty: buyQty,
          usd,
          reason: gate.reason,
          costsUsd: c,
        });
      }
    }
  }

  if (qty > 0) {
    const last = bars[bars.length - 1]!;
    const usd = qty * last.close;
    const c = costsUsd(usd, impactBps(usd, primary.liquidityUsd), 0.02);
    cash += usd - c;
    trades.push({
      mint: primary.mint,
      side: "SELL",
      barIndex: bars.length - 1,
      timestamp: last.timestamp,
      price: last.close,
      qty,
      usd,
      reason: "eod-flatten",
      costsUsd: c,
    });
    qty = 0;
  }

  const bench = params.benchmark ?? bars;
  const b0 = bench[0]?.close ?? 0;
  const benchmarkEquity = bench.map((b) => (b0 > 0 ? startCash * (b.close / b0) : startCash));
  const feeDragUsd = trades.reduce((s, t) => s + t.costsUsd, 0);
  const perf = computePerformance(equity, feeDragUsd);
  const hide = trades.length < 10 || equity.length < 30;
  if (hide) warnings.push("INSUFFICIENT SAMPLE — metrics hidden");
  if (failed.length) warnings.push(...failed.slice(0, 3));
  warnings.push("BACKTEST / PAPER — not live profitability");
  if (isDemo) warnings.push("DEMO data path");

  const oosReturnPct =
    oosStartNav && oosEndNav && oosStartNav > 0 ? ((oosEndNav - oosStartNav) / oosStartNav) * 100 : null;

  return BacktestResultSchema.parse({
    id: newId(),
    strategyVersion: config.version,
    datasetVersion: config.datasetVersion,
    config,
    equity,
    benchmarkEquity,
    trades,
    metrics: hide
      ? null
      : {
          totalReturnPct: perf.totalReturnPct,
          maxDrawdownPct: perf.maxDrawdownPct,
          sharpe: perf.sharpe,
          sortino: perf.sortino,
          winRate: perf.hitRate,
          profitFactor: null,
          expectancy: null,
          turnover: trades.reduce((s, t) => s + t.usd, 0),
          tradeCount: trades.length,
          feeDragUsd,
          sampleSize: equity.length,
        },
    warnings,
    dataCoverage: {
      bars: bars.length,
      interval: "input",
      startMs: bars[0]?.timestamp ?? null,
      endMs: bars[bars.length - 1]?.timestamp ?? null,
    },
    walkForward: params.walkForward
      ? {
          trainBars: trainEnd,
          validationBars: validEnd - trainEnd,
          testBars: bars.length - validEnd,
          oosReturnPct,
        }
      : null,
    isDemo,
    label: isDemo ? "DEMO" : "BACKTEST",
    createdAt: nowIso(),
  });
}

export function randomEntryControl(bars: OhlcvBar[], startingCapital = 100_000, seed = 7): number[] {
  let cash = startingCapital;
  let qty = 0;
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const eq: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    const px = bars[i]!.close;
    if (qty === 0 && rand() < 0.04 && i + 1 < bars.length) {
      const fill = bars[i + 1]!.open;
      const usd = Math.min(2_500, cash * 0.2);
      qty = usd / fill;
      cash -= usd;
    } else if (qty > 0 && rand() < 0.08) {
      cash += qty * px;
      qty = 0;
    }
    eq.push(cash + qty * px);
  }
  return eq;
}
