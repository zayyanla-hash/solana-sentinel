import {
  type CandidateAsset,
  type PaperOrder,
  type Position,
  type PortfolioSnapshot,
  type SystemEvent,
  type TradeProposal,
  type TokenRiskAssessment,
  type PolicyAssessment,
  type OpportunityScore,
  type ResearchBrief,
  type SignalResult,
  type WalletCredibilityScore,
  type SentinelSignal,
  type AlertRule,
  type BacktestResult,
  type WatchlistItem,
} from "@sat/shared";
import type { ExperimentResult } from "@sat/experiments";

export interface StoredSignal extends SignalResult {
  mint: string;
}

export interface FillUnitOfWork {
  proposalId: string;
  proposal: TradeProposal;
  order: PaperOrder;
  snapshot: PortfolioSnapshot;
  positions: Position[];
  events: SystemEvent[];
  navUsd: number;
  consumeProposal: boolean;
}

export class AlreadyExecutedError extends Error {
  constructor(message = "Proposal already paper-executed") {
    super(message);
    this.name = "AlreadyExecutedError";
  }
}

export interface StoreSnapshot {
  mode: "memory" | "postgres";
  candidates: CandidateAsset[];
  proposals: TradeProposal[];
  orders: PaperOrder[];
  positions: Position[];
  portfolio: PortfolioSnapshot;
  events: SystemEvent[];
  tokenRisk: TokenRiskAssessment[];
  policies: PolicyAssessment[];
  scores: OpportunityScore[];
  research: ResearchBrief[];
  experiments: ExperimentResult[];
  signals: StoredSignal[];
  equityHistory: Array<{ t: string; nav: number }>;
  parseErrors: number;
  watchlist: WatchlistItem[];
  walletScores: WalletCredibilityScore[];
  sentinelSignals: SentinelSignal[];
  alertRules: AlertRule[];
  backtests: BacktestResult[];
}

export interface Database {
  readonly mode: "memory" | "postgres";
  getState(): Promise<StoreSnapshot>;
  setCandidates(c: CandidateAsset[]): Promise<void>;
  addProposal(p: TradeProposal): Promise<void>;
  addOrder(o: PaperOrder): Promise<void>;
  setPositions(p: Position[]): Promise<void>;
  setPortfolio(s: PortfolioSnapshot): Promise<void>;
  addEvents(e: SystemEvent[]): Promise<void>;
  addTokenRisk(a: TokenRiskAssessment): Promise<void>;
  addPolicy(a: PolicyAssessment): Promise<void>;
  addScore(s: OpportunityScore): Promise<void>;
  addResearch(r: ResearchBrief): Promise<void>;
  addExperiment(e: ExperimentResult): Promise<void>;
  addSignals(mint: string, signals: SignalResult[]): Promise<void>;
  pushEquity(nav: number): Promise<void>;
  consumeProposalAndRecordFill(work: FillUnitOfWork): Promise<void>;
  reset(startingCapital: number): Promise<void>;
  setWatchlist(items: WatchlistItem[]): Promise<void>;
  setWalletScores(scores: WalletCredibilityScore[]): Promise<void>;
  setSentinelSignals(signals: SentinelSignal[]): Promise<void>;
  addAlertRule(rule: AlertRule): Promise<void>;
  addBacktest(result: BacktestResult): Promise<void>;
}
