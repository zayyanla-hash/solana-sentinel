export interface EquityPoint {
  t: string;
  nav: number;
}

export interface PerformanceMetrics {
  totalReturnPct: number;
  maxDrawdownPct: number;
  sharpe: number | null;
  sortino: number | null;
  sampleSize: number;
  warnings: string[];
  costDragUsd: number;
  volatilityPct: number | null;
  hitRate: number | null;
  avgGainPct: number | null;
  avgLossPct: number | null;
}

export function computeDrawdown(series: number[]): number {
  let peak = series[0] ?? 0;
  let maxDd = 0;
  for (const v of series) {
    peak = Math.max(peak, v);
    if (peak > 0) maxDd = Math.max(maxDd, (peak - v) / peak);
  }
  return maxDd;
}

export function computeReturns(series: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1]!;
    const cur = series[i]!;
    if (prev !== 0) out.push((cur - prev) / prev);
  }
  return out;
}

export function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

export function computePerformance(
  equity: number[],
  costDragUsd = 0,
): PerformanceMetrics {
  const warnings: string[] = [];
  const sampleSize = equity.length;
  if (sampleSize < 30) {
    warnings.push("Sample size < 30 — Sharpe/Sortino are unreliable");
  }
  const start = equity[0] ?? 0;
  const end = equity[equity.length - 1] ?? 0;
  const totalReturnPct = start > 0 ? ((end - start) / start) * 100 : 0;
  const maxDrawdownPct = computeDrawdown(equity) * 100;
  const rets = computeReturns(equity);
  const vol = stdev(rets);
  const avg = mean(rets);
  let sharpe: number | null = null;
  let sortino: number | null = null;
  if (rets.length >= 5 && vol > 0) {
    sharpe = (avg / vol) * Math.sqrt(252);
  } else {
    warnings.push("Insufficient return observations for Sharpe");
  }
  const downside = rets.filter((r) => r < 0);
  const dstd = stdev(downside);
  if (downside.length >= 3 && dstd > 0) {
    sortino = (avg / dstd) * Math.sqrt(252);
  } else {
    warnings.push("Insufficient downside observations for Sortino");
  }
  const gains = rets.filter((r) => r > 0);
  const losses = rets.filter((r) => r < 0);
  const hitRate = rets.length >= 5 ? gains.length / rets.length : null;
  const avgGainPct = gains.length >= 3 ? mean(gains) * 100 : null;
  const avgLossPct = losses.length >= 3 ? mean(losses) * 100 : null;
  return {
    totalReturnPct,
    maxDrawdownPct,
    sharpe,
    sortino,
    sampleSize,
    warnings,
    costDragUsd,
    volatilityPct: vol > 0 ? vol * Math.sqrt(252) * 100 : null,
    hitRate,
    avgGainPct,
    avgLossPct,
  };
}

export function equalWeightSeries(seriesList: number[][]): number[] {
  if (!seriesList.length) return [];
  const len = Math.min(...seriesList.map((s) => s.length));
  if (len < 2) return [];
  const out: number[] = [];
  const start = seriesList.reduce((s, row) => s + (row[0] ?? 0), 0) / seriesList.length;
  for (let i = 0; i < len; i++) {
    const avg = seriesList.reduce((s, row) => s + (row[i] ?? 0), 0) / seriesList.length;
    out.push(start > 0 ? avg / start : 1);
  }
  return out;
}

export function buyAndHoldSeries(
  startNav: number,
  startPrice: number,
  prices: number[],
): number[] {
  if (startPrice <= 0) return prices.map(() => startNav);
  const qty = startNav / startPrice;
  return prices.map((p) => qty * p);
}
