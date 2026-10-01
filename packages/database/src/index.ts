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
import { createInitialPortfolio } from "@sat/portfolio";
import { isDeepStrictEqual } from "node:util";
import type { Database, StoreSnapshot, StoredSignal, FillUnitOfWork, MarkUnitOfWork } from "./types";
import { AlreadyExecutedError, StalePortfolioError } from "./types";
import { PostgresDatabase } from "./postgres";

export type { Database, StoreSnapshot, StoredSignal, FillUnitOfWork, MarkUnitOfWork };

export class InMemoryDatabase implements Database {
  readonly mode = "memory" as const;
  private state: StoreSnapshot;
  private tail: Promise<void> = Promise.resolve();

  constructor(startingCapital = Number(process.env.PAPER_STARTING_CAPITAL_USD ?? 100_000)) {
    this.state = emptyState(startingCapital, "memory");
  }

  private enqueue<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async getState(): Promise<StoreSnapshot> {
    return structuredClone(this.state);
  }

  async setCandidates(c: CandidateAsset[]) {
    this.state.candidates = c;
  }
  async addProposal(p: TradeProposal) {
    this.state.proposals = [p, ...this.state.proposals.filter((x) => x.id !== p.id)];
  }
  async addOrder(o: PaperOrder) {
    this.state.orders.unshift(o);
  }
  async setPositions(p: Position[]) {
    this.state.positions = p;
  }
  async setPortfolio(s: PortfolioSnapshot) {
    this.state.portfolio = s;
  }
  async addEvents(e: SystemEvent[]) {
    this.state.events.unshift(...e);
  }
  async addTokenRisk(a: TokenRiskAssessment) {
    this.state.tokenRisk = [a, ...this.state.tokenRisk.filter((x) => x.mint !== a.mint)].slice(
      0,
      200,
    );
  }
  async addPolicy(a: PolicyAssessment) {
    this.state.policies = [a, ...this.state.policies.filter((x) => x.mint !== a.mint)].slice(
      0,
      200,
    );
  }
  async addScore(s: OpportunityScore) {
    this.state.scores = [s, ...this.state.scores.filter((x) => x.mint !== s.mint)].slice(0, 200);
  }
  async addResearch(r: ResearchBrief) {
    this.state.research = [r, ...this.state.research.filter((x) => x.mint !== r.mint)].slice(
      0,
      200,
    );
  }
  async addExperiment(e: ExperimentResult) {
    this.state.experiments.unshift(e);
  }
  async addSignals(mint: string, signals: SignalResult[]) {
    this.state.signals = [
      ...signals.map((s) => ({ mint, ...s }) satisfies StoredSignal),
      ...this.state.signals.filter((x) => x.mint !== mint),
    ].slice(0, 500);
  }
  async pushEquity(nav: number) {
    this.state.equityHistory.push({ t: new Date().toISOString(), nav });
  }

  async consumeProposalAndRecordFill(work: FillUnitOfWork): Promise<void> {
    return this.enqueue(async () => {
      if (work.consumeProposal) {
        const current = this.state.proposals.find((p) => p.id === work.proposalId);
        if (!current || current.status !== "PROPOSED") {
          throw new AlreadyExecutedError();
        }
      }
      const sorted = (positions: Position[]) => [...positions].sort((a, b) => a.id.localeCompare(b.id));
      if (
        !work.expectedPortfolio || !work.expectedPositions ||
        !isDeepStrictEqual(this.state.portfolio, work.expectedPortfolio) ||
        !isDeepStrictEqual(sorted(this.state.positions), sorted(work.expectedPositions))
      ) {
        throw new StalePortfolioError();
      }
      if (work.consumeProposal) {
        this.state.proposals = [
          work.proposal,
          ...this.state.proposals.filter((x) => x.id !== work.proposalId),
        ];
      }
      this.state.orders.unshift(work.order);
      this.state.portfolio = work.snapshot;
      this.state.positions = work.positions;
      this.state.events.unshift(...work.events);
      this.state.equityHistory.push({ t: new Date().toISOString(), nav: work.navUsd });
    });
  }
  async recordMarkToMarket(work: MarkUnitOfWork): Promise<void> {
    return this.enqueue(() => {
      const sorted = (positions: Position[]) => [...positions].sort((a, b) => a.id.localeCompare(b.id));
      if (
        !isDeepStrictEqual(this.state.portfolio, work.expectedPortfolio) ||
        !isDeepStrictEqual(sorted(this.state.positions), sorted(work.expectedPositions))
      ) {
        throw new StalePortfolioError();
      }
      this.state.positions = work.positions;
      this.state.portfolio = work.snapshot;
      this.state.equityHistory.push({ t: work.snapshot.timestamp, nav: work.navUsd });
    });
  }
  async reset(startingCapital: number) {
    this.state = emptyState(startingCapital, "memory");
  }
  async setWatchlist(items: WatchlistItem[]) {
    this.state.watchlist = items;
  }
  async setWalletScores(scores: WalletCredibilityScore[]) {
    this.state.walletScores = scores.slice(0, 200);
  }
  async setSentinelSignals(signals: SentinelSignal[]) {
    this.state.sentinelSignals = signals.slice(0, 200);
  }
  async addAlertRule(rule: AlertRule) {
    this.state.alertRules = [rule, ...this.state.alertRules.filter((r) => r.id !== rule.id)].slice(0, 100);
  }
  async addBacktest(result: BacktestResult) {
    this.state.backtests = [result, ...this.state.backtests].slice(0, 50);
  }
}

function emptyState(startingCapital: number, mode: StoreSnapshot["mode"]): StoreSnapshot {
  const { snapshot, positions } = createInitialPortfolio(startingCapital);
  return {
    mode,
    candidates: [],
    proposals: [],
    orders: [],
    positions,
    portfolio: snapshot,
    events: [],
    tokenRisk: [],
    policies: [],
    scores: [],
    research: [],
    experiments: [],
    signals: [],
    equityHistory: [{ t: snapshot.timestamp, nav: snapshot.navUsd }],
    parseErrors: 0,
    watchlist: [],
    walletScores: [],
    sentinelSignals: [],
    alertRules: [],
    backtests: [],
  };
}

let singleton: Database | null = null;

export function databaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL?.trim();
  return url ? url : undefined;
}

export function getDatabase(): Database {
  if (!singleton) {
    const url = databaseUrl();
    singleton = url
      ? new PostgresDatabase(url)
      : new InMemoryDatabase();
  }
  return singleton;
}

export function resetDatabaseForTests(startingCapital = 100_000): InMemoryDatabase {
  const mem = new InMemoryDatabase(startingCapital);
  singleton = mem;
  return mem;
}

export async function closeDatabaseForTests(): Promise<void> {
  if (singleton && singleton instanceof PostgresDatabase) {
    await singleton.close();
  }
  singleton = null;
}

export const closeDatabase = closeDatabaseForTests;

export { PostgresDatabase, buildPoolConfig } from "./postgres";
export { AlreadyExecutedError, StalePortfolioError };
export { STORE_SCHEMA_SQL, STORE_SCHEMA_VERSION } from "./schema-sql";
