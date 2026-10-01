import type { ActivityItem, Observation } from "./types";

export type ChartKind = "buy" | "sell" | "failed" | "other";
export type ChartFilter = "all" | "buys" | "sells" | "unclassified";

export type ChartPoint = {
  id: string;
  wallet: string;
  signature: string;
  slot: number;
  /** Unix seconds, when the observation carries a block time. */
  time: number | null;
  kind: ChartKind;
  /** Cumulative observation count after this point (the line's y value). */
  count: number;
  item: ActivityItem;
};

/** The first supported leg decides BUY or SELL; failed transactions are never trades; everything else is unclassified. */
export function classify(item: ActivityItem): ChartKind {
  if (item.outcome === "FAILED") return "failed";
  const side = item.trades.find((trade) => trade.side === "BUY" || trade.side === "SELL")?.side;
  if (side === "BUY") return "buy";
  if (side === "SELL") return "sell";
  return "other";
}

const byChain = (a: Observation, b: Observation) =>
  a.item.slot - b.item.slot || (a.item.blockTime ?? 0) - (b.item.blockTime ?? 0) || a.item.signature.localeCompare(b.item.signature);

/** Newest first, by slot (slots are monotonic with time, so this also orders items that have no block time). */
export function sortNewestFirst<T extends Observation>(items: T[]): T[] {
  return [...items].sort((a, b) => byChain(b, a));
}

/** Oldest first; y is the running count of observations in the window. */
export function buildPoints(observations: Observation[]): ChartPoint[] {
  return [...observations].sort(byChain).map(({ wallet, item }, index) => ({
    id: `${wallet}:${item.signature}`,
    wallet,
    signature: item.signature,
    slot: item.slot,
    time: typeof item.blockTime === "number" && item.blockTime > 0 ? item.blockTime : null,
    kind: classify(item),
    count: index + 1,
    item,
  }));
}

/** Whether a point is drawn as a marker under the active filter. Unclassified steps are only marked on request. */
export function isMarked(kind: ChartKind, filter: ChartFilter): boolean {
  if (kind === "failed") return filter === "all";
  if (kind === "buy") return filter === "all" || filter === "buys";
  if (kind === "sell") return filter === "all" || filter === "sells";
  return filter === "unclassified";
}

export type XMode = "time" | "slot";

export type Layout = {
  width: number;
  height: number;
  baseline: number;
  mode: XMode;
  xs: number[];
  ys: number[];
  /** SVG path for the cumulative step line. */
  path: string;
};

export type Pad = { left: number; right: number; top: number; bottom: number };

/**
 * x is the block time when every point has one, otherwise the slot (slot order, proportionally spaced).
 * A degenerate span (one point, or all equal) falls back to even spacing.
 */
export function layoutChart(points: ChartPoint[], width: number, height: number, pad: Pad): Layout {
  const baseline = height - pad.bottom;
  const mode: XMode = points.length > 0 && points.every((p) => p.time !== null) ? "time" : "slot";
  const values = points.map((p) => (mode === "time" ? (p.time as number) : p.slot));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const inner = Math.max(1, width - pad.left - pad.right);
  const xs = values.map((v, i) => pad.left + (span > 0 ? ((v - min) / span) * inner : points.length > 1 ? (i / (points.length - 1)) * inner : inner / 2));
  const top = pad.top;
  const total = Math.max(1, points.length);
  const ys = points.map((p) => baseline - (p.count / total) * (baseline - top));
  let path = `M${pad.left},${baseline.toFixed(1)}`;
  xs.forEach((x, i) => { path += ` H${x.toFixed(1)} V${ys[i]!.toFixed(1)}`; });
  path += ` H${(width - pad.right).toFixed(1)}`;
  return { width, height, baseline, mode, xs, ys, path: points.length ? path : "" };
}

/** Index of the point whose x is nearest to the pointer. -1 when there are no points. */
export function nearestIndex(xs: number[], x: number): number {
  let best = -1;
  let distance = Infinity;
  xs.forEach((value, i) => {
    const d = Math.abs(value - x);
    if (d < distance) { distance = d; best = i; }
  });
  return best;
}

/** Compact step path for a per-wallet sparkline. */
export function sparklinePath(observations: Observation[], width: number, height: number): string {
  const points = buildPoints(observations);
  if (!points.length) return "";
  const layout = layoutChart(points, width, height, { left: 0, right: 0, top: 2, bottom: 2 });
  return layout.path;
}

export function chartSummary(points: ChartPoint[]): string {
  const count = (kind: ChartKind) => points.filter((p) => p.kind === kind).length;
  return `${points.length} observations in the recent window: ${count("buy")} buys, ${count("sell")} sells, ${count("failed")} failed, ${count("other")} unclassified.`;
}
