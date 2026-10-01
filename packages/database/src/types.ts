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
  type AlertEvent,
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
  /** State used to calculate the fill. Required for every atomic fill. */
  expectedPortfolio: PortfolioSnapshot;
  expectedPositions: Position[];
  snapshot: PortfolioSnapshot;
  positions: Position[];
  events: SystemEvent[];
  navUsd: number;
  consumeProposal: boolean;
}

export interface MarkUnitOfWork {
  expectedPortfolio: PortfolioSnapshot;
  expectedPositions: Position[];
  snapshot: PortfolioSnapshot;
  positions: Position[];
  navUsd: number;
}

export class AlreadyExecutedError extends Error {
  constructor(message = "Proposal already paper-executed") {
    super(message);
    this.name = "AlreadyExecutedError";
  }
}

export class StalePortfolioError extends Error {
  constructor(message = "Portfolio changed before state update; re-evaluate and retry explicitly") {
    super(message);
    this.name = "StalePortfolioError";
  }
}

export interface AlertCooldown {
  key: string;
  expiresAt: string;
}

/** Validate only cooldowns for delivered INTERNAL events; other channels have no delivery gate. */
export function validateAlertCooldown(event: AlertEvent, cooldown?: AlertCooldown): AlertCooldown | null {
  if (!cooldown || event.channel !== "INTERNAL" || !event.delivered) return null;
  const created = Date.parse(event.createdAt);
  const expires = Date.parse(cooldown.expiresAt);
  const hasControl = typeof cooldown.key === "string" &&
    [...cooldown.key].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
  if (typeof cooldown.key !== "string" || !cooldown.key.trim() || cooldown.key.length > 512 ||
    hasControl || !Number.isFinite(created) || !Number.isFinite(expires) ||
    expires <= created || expires <= Date.now()) {
    throw new Error("ALERT_INVALID_COOLDOWN");
  }
  return { key: cooldown.key, expiresAt: new Date(expires).toISOString() };
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
  alertEvents: AlertEvent[];
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
  recordMarkToMarket(work: MarkUnitOfWork): Promise<void>;
  reset(startingCapital: number): Promise<void>;
  setWatchlist(items: WatchlistItem[]): Promise<void>;
  addWatchlistItem(item: WatchlistItem, maxItems: number): Promise<WatchlistItem>;
  removeWatchlistItem(id: string): Promise<void>;
  setWalletScores(scores: WalletCredibilityScore[]): Promise<void>;
  upsertWalletScore(score: WalletCredibilityScore): Promise<void>;
  setSentinelSignals(signals: SentinelSignal[]): Promise<void>;
  addAlertRule(rule: AlertRule): Promise<void>;
  addAlertEvents(events: AlertEvent[]): Promise<void>;
  recordAlertEvent(event: AlertEvent, cooldown?: AlertCooldown): Promise<AlertEvent>;
  addBacktest(result: BacktestResult): Promise<void>;
}
