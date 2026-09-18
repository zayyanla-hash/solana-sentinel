import {
  type PortfolioSnapshot,
  type Position,
  nowIso,
} from "@sat/shared";

export function createInitialPortfolio(startingCapitalUsd: number): {
  snapshot: PortfolioSnapshot;
  positions: Position[];
} {
  const ts = nowIso();
  return {
    snapshot: {
      timestamp: ts,
      navUsd: startingCapitalUsd,
      cashUsd: startingCapitalUsd,
      positionsValueUsd: 0,
      drawdownPct: 0,
      peakNavUsd: startingCapitalUsd,
    },
    positions: [],
  };
}

export function markPositions(
  positions: Position[],
  marks: Record<string, number>,
  snapshot: PortfolioSnapshot,
): { positions: Position[]; snapshot: PortfolioSnapshot } {
  const next = positions.map((p) => {
    const mark = marks[p.mint] ?? p.markUsd;
    return {
      ...p,
      markUsd: mark,
      unrealizedPnlUsd: mark * p.qty - p.avgEntryUsd * p.qty,
      updatedAt: nowIso(),
    };
  });
  const positionsValueUsd = next.reduce((s, p) => s + p.qty * p.markUsd, 0);
  const navUsd = snapshot.cashUsd + positionsValueUsd;
  const peakNavUsd = Math.max(snapshot.peakNavUsd, navUsd);
  return {
    positions: next,
    snapshot: {
      timestamp: nowIso(),
      navUsd,
      cashUsd: snapshot.cashUsd,
      positionsValueUsd,
      drawdownPct: peakNavUsd > 0 ? (peakNavUsd - navUsd) / peakNavUsd : 0,
      peakNavUsd,
    },
  };
}

export function proposeSizeUsd(
  navUsd: number,
  score: number,
  maxPositionUsd: number,
): number {
  const scoreFactor = Math.min(Math.max(score / 100, 0.2), 1);
  return Math.min(maxPositionUsd, navUsd * 0.05 * scoreFactor);
}

export interface PortfolioLimits {
  maxPositionUsd: number;
  maxSimultaneousPositions: number;
  maxPortfolioExposurePct: number;
  maxDrawdownPct: number;
}

export interface PortfolioExposure {
  navUsd: number;
  cashUsd: number;
  positionsValueUsd: number;
  drawdownPct: number;
  openPositions: number;
  largestPositionPct: number | null;
  herfindahl: number | null;
  withinPositionLimit: boolean;
  withinCountLimit: boolean;
  withinExposureLimit: boolean;
  withinDrawdownLimit: boolean;
  warnings: string[];
}

export function assessPortfolioExposure(
  snapshot: PortfolioSnapshot,
  positions: Position[],
  limits: PortfolioLimits,
): PortfolioExposure {
  const notionals = positions.map((p) => p.qty * p.markUsd);
  const positionsValueUsd = notionals.reduce((s, n) => s + n, 0);
  const largest = notionals.length ? Math.max(...notionals) : 0;
  const largestPositionPct = snapshot.navUsd > 0 && largest > 0 ? largest / snapshot.navUsd : null;
  const herfindahl =
    positionsValueUsd > 0 ? notionals.reduce((s, n) => s + (n / positionsValueUsd) ** 2, 0) : null;
  const warnings: string[] = [];
  const withinPositionLimit = largest <= limits.maxPositionUsd + 1e-6;
  const withinCountLimit = positions.length <= limits.maxSimultaneousPositions;
  const exposurePct = snapshot.navUsd > 0 ? positionsValueUsd / snapshot.navUsd : 0;
  const withinExposureLimit = exposurePct <= limits.maxPortfolioExposurePct + 1e-9;
  const withinDrawdownLimit = snapshot.drawdownPct <= limits.maxDrawdownPct + 1e-9;
  if (!withinPositionLimit) warnings.push("Largest position exceeds maxPositionUsd");
  if (!withinCountLimit) warnings.push("Open position count exceeds cap");
  if (!withinExposureLimit) warnings.push("Portfolio exposure exceeds cap");
  if (!withinDrawdownLimit) warnings.push("Drawdown exceeds cap");
  return {
    navUsd: snapshot.navUsd,
    cashUsd: snapshot.cashUsd,
    positionsValueUsd,
    drawdownPct: snapshot.drawdownPct,
    openPositions: positions.length,
    largestPositionPct,
    herfindahl,
    withinPositionLimit,
    withinCountLimit,
    withinExposureLimit,
    withinDrawdownLimit,
    warnings,
  };
}
