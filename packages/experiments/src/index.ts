import {
  computePerformance,
  buyAndHoldSeries,
  equalWeightSeries,
  type PerformanceMetrics,
} from "@sat/analytics";
import {
  DEFAULT_STRATEGY_CONFIG,
  DEFAULT_RISK_CONFIG,
  type StrategyConfig,
  type RiskConfig,
  newId,
  nowIso,
} from "@sat/shared";

export type ExperimentDataQuality =
  | "PAPER_EQUITY"
  | "INSUFFICIENT_HISTORY"
  | "DEMO_DATA";

export interface ExperimentConfig {
  id: string;
  name: string;
  strategy: StrategyConfig;
  risk: RiskConfig;
  dataSource: string;
  createdAt: string;
}

export interface ExperimentResult {
  experiment: ExperimentConfig;
  strategyMetrics: PerformanceMetrics | null;
  baselines: {
    cash: PerformanceMetrics | null;
    solBuyHold: PerformanceMetrics | null;
    btcBuyHold: PerformanceMetrics | null;
    mechanicalMomentum: PerformanceMetrics | null;
    equalWeightCandidates: PerformanceMetrics | null;
  };
  notes: string[];
  dataQuality: ExperimentDataQuality;
  isDemo: boolean;
}

export function createExperiment(
  name: string,
  overrides?: Partial<{ strategy: StrategyConfig; risk: RiskConfig; dataSource: string }>,
): ExperimentConfig {
  return {
    id: newId(),
    name,
    strategy: overrides?.strategy ?? DEFAULT_STRATEGY_CONFIG,
    risk: overrides?.risk ?? DEFAULT_RISK_CONFIG,
    dataSource: overrides?.dataSource ?? "demo",
    createdAt: nowIso(),
  };
}

/** Replay observed equity only. Does not invent SOL/BTC paths or sine-wave performance. */
export function runExperimentReplay(params: {
  name: string;
  strategyEquity: number[];
  solPrices?: number[];
  btcPrices?: number[];
  startingCapital: number;
  costDragUsd?: number;
  mechanicalEquity?: number[];
  candidatePriceSeries?: number[][];
  dataQuality?: ExperimentDataQuality;
  isDemo?: boolean;
  dataSource?: string;
}): ExperimentResult {
  const experiment = createExperiment(params.name, {
    dataSource: params.dataSource,
  });
  const isDemo = params.isDemo ?? true;
  const insufficient = params.strategyEquity.length < 10;
  const dataQuality: ExperimentDataQuality =
    params.dataQuality ?? (insufficient ? "INSUFFICIENT_HISTORY" : "PAPER_EQUITY");

  const notes = [
    isDemo ? "DEMO DATA — not verified live performance" : "PAPER equity replay — not live trading performance",
    `Strategy config ${experiment.strategy.version}; risk ${experiment.risk.version}`,
    `Data source: ${experiment.dataSource}`,
  ];

  if (insufficient) {
    notes.unshift(
      "INSUFFICIENT HISTORY — metrics hidden rather than inventing a trajectory",
    );
    return {
      experiment,
      strategyMetrics: null,
      baselines: {
        cash: null,
        solBuyHold: null,
        btcBuyHold: null,
        mechanicalMomentum: null,
        equalWeightCandidates: null,
      },
      notes,
      dataQuality: "INSUFFICIENT_HISTORY",
      isDemo,
    };
  }

  const cashSeries = params.strategyEquity.map(() => params.startingCapital);
  const solBh =
    params.solPrices && params.solPrices.length >= 2
      ? buyAndHoldSeries(params.startingCapital, params.solPrices[0] ?? 1, params.solPrices)
      : null;
  const btcBh =
    params.btcPrices && params.btcPrices.length >= 2
      ? buyAndHoldSeries(params.startingCapital, params.btcPrices[0] ?? 1, params.btcPrices)
      : null;
  const mechanical = params.mechanicalEquity
    ? computePerformance(params.mechanicalEquity)
    : null;
  const ewNorm = params.candidatePriceSeries
    ? equalWeightSeries(params.candidatePriceSeries)
    : [];
  const ew =
    ewNorm.length >= 2
      ? computePerformance(ewNorm.map((x) => params.startingCapital * x))
      : null;

  if (!solBh) notes.push("SOL buy-and-hold omitted — no historical SOL series supplied");
  if (!btcBh) notes.push("BTC buy-and-hold omitted — no historical BTC series supplied");
  if (!ew) notes.push("Equal-weight candidate baseline omitted — no aligned series");

  return {
    experiment,
    strategyMetrics: computePerformance(params.strategyEquity, params.costDragUsd ?? 0),
    baselines: {
      cash: computePerformance(cashSeries),
      solBuyHold: solBh ? computePerformance(solBh) : null,
      btcBuyHold: btcBh ? computePerformance(btcBh) : null,
      mechanicalMomentum: mechanical,
      equalWeightCandidates: ew,
    },
    notes,
    dataQuality,
    isDemo,
  };
}
