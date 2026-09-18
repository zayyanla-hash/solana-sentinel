import {
  DEFAULT_STRATEGY_CONFIG,
  DEFAULT_RISK_CONFIG,
  DEFAULT_POLICY_CONFIG,
  USDC,
  WSOL,
  type TradeProposal,
  type OpportunityScore,
  type OperatingMode,
  type PaperOrder,
  newId,
  nowIso,
  createEvent,
  isLiveTradingAllowed,
  isPublicDemo,
  ExecutionPlanSchema,
  PROPOSAL_TTL_MS,
} from "@sat/shared";
import { getDatabase, AlreadyExecutedError, type Database } from "@sat/database";
import type { HistoricalBars } from "@sat/signals";
import { DiscoveryService } from "@sat/discovery";
import { computeAllSignals, scoreOpportunity } from "@sat/signals";
import { assessTokenRisk } from "@sat/token-risk";
import { fetchJupiterTokenIntel } from "@sat/solana";
import { PolicyEngine } from "@sat/policy-engine";
import { RiskEngine } from "@sat/risk-engine";
import { proposeSizeUsd, markPositions } from "@sat/portfolio";
import { PaperTradingEngine, applyFillToPortfolio } from "@sat/paper-trading";
import { runExperimentReplay } from "@sat/experiments";
import { getProviders } from "./providers";
import { generateSmartMoneySignals } from "./intelligence";
import { overallStatus, setProviderHealth } from "@sat/observability";
import {
  decideProposalStatus,
  assertStoredGates,
  assertNotExpired,
  assertFreshRisk,
} from "./gates";

export { getProviders, resetProvidersForTests } from "./providers";
export {
  listWalletIntelligence,
  analyzeWallet,
  walletGraphForDemo,
  generateSmartMoneySignals,
  runStrategyLab,
  createAlertRule,
  emitTestAlert,
  getAlertEngine,
  resetIntelligenceForTests,
  addWatchlistItem,
  removeWatchlistItem,
  portfolioRiskSnapshot,
} from "./intelligence";
export { verifyLiveWallet, compareWalletProviders } from "./verify-wallet";
export {
  decideProposalStatus,
  assertStoredGates,
  assertNotExpired,
  assertFreshRisk,
} from "./gates";

export function getOperatingMode(): OperatingMode {
  const m = (process.env.OPERATING_MODE ?? "PAPER").toUpperCase();
  if (m === "LIVE") return "PAPER";
  if (m === "DEMO" || m === "READ_ONLY" || m === "PAPER") return m;
  return "PAPER";
}

export function lastTradeAtByMint(orders: PaperOrder[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of orders) {
    if (o.status !== "FILLED" && o.status !== "PARTIAL") continue;
    const prev = out[o.mint];
    if (!prev || Date.parse(o.createdAt) > Date.parse(prev)) {
      out[o.mint] = o.createdAt;
    }
  }
  return out;
}

export async function runDiscoveryCycle(db: Database = getDatabase()) {
  const { market } = getProviders();
  const discovery = new DiscoveryService(market);
  const { candidates, events, mode } = await discovery.discover(20);
  await db.setCandidates(candidates);
  await db.addEvents(events);
  await db.addEvents([
    createEvent("TOKEN_DISCOVERED", `Discovery cycle complete (${mode})`, {
      payload: { count: candidates.length, provider: market.name, isDemo: market.isDemo },
    }),
  ]);
  return { candidates, mode, provider: market.name, isDemo: market.isDemo };
}

async function loadHistorical(mint: string): Promise<HistoricalBars | undefined> {
  const { market } = getProviders();
  try {
    const [b5, b15, b1h, b4h, b1d, sol5] = await Promise.all([
      market.getOhlcv(mint, "5m", 120),
      market.getOhlcv(mint, "15m", 96),
      market.getOhlcv(mint, "1h", 72),
      market.getOhlcv(mint, "4h", 48),
      market.getOhlcv(mint, "1d", 90),
      market.getOhlcv(WSOL, "5m", 120),
    ]);
    const empty = ![b5, b15, b1h, b4h].some((b) => b.length);
    if (empty) return undefined;
    return {
      "5m": b5,
      "15m": b15,
      "1h": b1h,
      "4h": b4h,
      "1d": b1d,
      sol: { "5m": sol5 },
      asOfMs: Date.now(),
    };
  } catch {
    return undefined;
  }
}

function dailyTurnoverUsd(orders: PaperOrder[]): number {
  return orders
    .filter((o) => Date.now() - Date.parse(o.createdAt) < 86_400_000)
    .reduce((s, o) => s + o.filledUsd, 0);
}

export async function evaluateMint(
  mint: string,
  db: Database = getDatabase(),
): Promise<TradeProposal | null> {
  const { market, onchain, research: researchProvider } = getProviders();
  const state = await db.getState();
  let asset = state.candidates.find((c) => c.mint === mint);
  if (!asset) {
    asset = (await market.getAsset(mint)) ?? undefined;
  }
  if (!asset) return null;

  const riskInputs = await onchain.getTokenRiskInputs(mint);
  const jup = await fetchJupiterTokenIntel(mint);
  const tokenRisk = assessTokenRisk(asset, {
    ...riskInputs,
    jupiterVerified: jup.verified,
    jupiterOrganicScore: jup.organicScore,
  });
  await db.addTokenRisk(tokenRisk);

  const policyEngine = new PolicyEngine(DEFAULT_POLICY_CONFIG);
  const { assessment: policy, events: policyEvents } = policyEngine.evaluate(asset);
  await db.addPolicy(policy);
  await db.addEvents(policyEvents);

  const historical = await loadHistorical(mint);
  const { signals, events: signalEvents, regime } = computeAllSignals(
    asset,
    state.candidates.length ? state.candidates : [asset],
    historical,
  );
  await db.addEvents(signalEvents);
  await db.addSignals(mint, signals);

  const research = await researchProvider.research(
    asset,
    `regime=${regime}; riskTier=${tokenRisk.riskTier}`,
  );
  await db.addResearch(research);

  const scored = scoreOpportunity(asset, signals, {
    weights: DEFAULT_STRATEGY_CONFIG.weights,
    strategyConfigVersion: DEFAULT_STRATEGY_CONFIG.version,
    riskScore: tokenRisk.riskScore,
    researchConfidence: research.confidence,
  });

  const score: OpportunityScore = {
    id: newId(),
    mint: asset.mint,
    compositeScore: scored.compositeScore,
    gateScore: scored.gateScore,
    components: scored.components,
    weights: DEFAULT_STRATEGY_CONFIG.weights,
    strategyConfigVersion: DEFAULT_STRATEGY_CONFIG.version,
    explanation: scored.explanation,
    signalSources: scored.signalSources,
    scoredAt: nowIso(),
  };
  await db.addScore(score);

  const requested = proposeSizeUsd(
    state.portfolio.navUsd,
    score.gateScore ?? score.compositeScore,
    DEFAULT_RISK_CONFIG.maxPositionUsd,
  );

  const riskEngine = new RiskEngine(DEFAULT_RISK_CONFIG);
  const { result: risk, events: riskEvents } = riskEngine.evaluate(asset, {
    portfolio: state.portfolio,
    positions: state.positions,
    requestedSizeUsd: requested,
    score,
    estimatedPriceImpactPct: tokenRisk.details.estimatedPriceImpactPct,
    slippageBps: 50,
    dailyTurnoverUsd: dailyTurnoverUsd(state.orders),
    lastTradeAtByMint: lastTradeAtByMint(state.orders),
  });
  await db.addEvents(riskEvents);

  const status = decideProposalStatus({ policy, tokenRisk, risk });

  const dup = state.proposals.find(
    (p) =>
      p.mint === mint &&
      p.status === "PROPOSED" &&
      Date.now() - Date.parse(p.createdAt) < PROPOSAL_TTL_MS,
  );
  if (dup) {
    await db.addEvents([
      createEvent("TRADE_PROPOSED", "Duplicate proposal suppressed", {
        mint,
        payload: { existingId: dup.id },
      }),
    ]);
    return dup;
  }

  const isDemo = Boolean(asset.isDemo || onchain.isDemo || market.isDemo);
  const dataSources = [
    ...new Set([
      ...asset.dataSources,
      market.name,
      onchain.name,
      research.isMock ? "mock-research" : "llm-research",
    ]),
  ];
  const proposal: TradeProposal = {
    id: newId(),
    mint: asset.mint,
    symbol: asset.symbol,
    side: "BUY",
    sizeUsd: risk.approvedSizeUsd || requested,
    score,
    tokenRisk,
    policy,
    risk,
    research,
    signals,
    status,
    createdAt: nowIso(),
    isDemo,
    dataSources,
    provenance: {
      isDemo,
      dataSources,
      providerNames: [market.name, onchain.name],
      configVersions: {
        strategy: DEFAULT_STRATEGY_CONFIG.version,
        risk: DEFAULT_RISK_CONFIG.version,
        policy: DEFAULT_POLICY_CONFIG.version,
        tokenRisk: tokenRisk.configVersion,
      },
      tokenRiskId: tokenRisk.id,
      policyId: policy.id,
      researchId: research.id,
      scoreId: score.id,
    },
  };
  await db.addProposal(proposal);
  await db.addEvents([
    createEvent("TRADE_PROPOSED", `${status}: ${asset.symbol} $${proposal.sizeUsd.toFixed(0)}`, {
      mint,
      payload: { proposalId: proposal.id, status, isDemo, dataSources },
      configVersions: {
        strategy: DEFAULT_STRATEGY_CONFIG.version,
        risk: DEFAULT_RISK_CONFIG.version,
        policy: DEFAULT_POLICY_CONFIG.version,
      },
    }),
  ]);
  return proposal;
}

export async function executePaperProposal(
  proposalId: string,
  db: Database = getDatabase(),
) {
  const mode = getOperatingMode();
  if (mode === "READ_ONLY") {
    throw new Error("READ_ONLY mode — paper execution disabled");
  }

  const state = await db.getState();
  const proposal = state.proposals.find((p) => p.id === proposalId);
  if (!proposal) throw new Error("Proposal not found");
  assertStoredGates(proposal);
  assertNotExpired(proposal);

  const asset = state.candidates.find((c) => c.mint === proposal.mint);
  const mark = asset?.priceUsd;
  if (mark == null || mark <= 0) {
    throw new Error("NO_MARK — refuse paper fill without a price");
  }

  const requested = proposal.risk.approvedSizeUsd || proposal.sizeUsd;
  const riskEngine = new RiskEngine(DEFAULT_RISK_CONFIG);
  const { result: freshRisk } = riskEngine.evaluate(asset ?? {
    ...proposal.tokenRisk,
    mint: proposal.mint,
    symbol: proposal.symbol,
    name: proposal.symbol,
    timestamp: nowIso(),
    priceUsd: mark,
    marketCapUsd: null,
    liquidityUsd: proposal.tokenRisk.details.liquidityUsd,
    volume24hUsd: null,
    volumeChange24hPct: null,
    priceChange1hPct: null,
    priceChange24hPct: null,
    priceChange7dPct: null,
    tokenAgeHours: proposal.tokenRisk.details.tokenAgeHours,
    holderCount: null,
    decimals: null,
    metadata: {},
    dataSources: proposal.dataSources ?? [],
    riskFlags: [],
    isDemo: proposal.isDemo ?? true,
  }, {
    portfolio: state.portfolio,
    positions: state.positions,
    requestedSizeUsd: requested,
    score: proposal.score,
    estimatedPriceImpactPct: proposal.tokenRisk.details.estimatedPriceImpactPct,
    slippageBps: 50,
    dailyTurnoverUsd: dailyTurnoverUsd(state.orders),
    lastTradeAtByMint: lastTradeAtByMint(state.orders),
  });
  assertFreshRisk(freshRisk.decision);

  const { execution } = getProviders();
  const amount = String(Math.floor((freshRisk.approvedSizeUsd || requested) * 1_000_000));
  const quote = await execution.quote({
    inputMint: USDC,
    outputMint: proposal.mint,
    amount,
    slippageBps: 50,
  });
  const plan = ExecutionPlanSchema.parse(await execution.plan(quote, mode));

  const paper = new PaperTradingEngine();
  const isDemo = Boolean(quote.isDemo || asset?.isDemo || proposal.isDemo);
  const { order, events } = paper.createAndFill({
    mint: proposal.mint,
    side: proposal.side,
    requestedUsd: freshRisk.approvedSizeUsd || requested,
    markPriceUsd: mark,
    quote,
    provenance: {
      opportunityScoreId: proposal.score.id ?? proposal.id,
      riskAssessmentId: proposal.risk.configVersion,
      policyAssessmentId: proposal.policy.id,
      tokenRiskId: proposal.tokenRisk.id,
      researchId: proposal.research?.id,
      strategyConfigVersion: proposal.score.strategyConfigVersion,
      riskConfigVersion: proposal.risk.configVersion,
      dataSources: proposal.dataSources ?? asset?.dataSources ?? ["demo"],
      reasons: [
        ...proposal.score.explanation,
        ...freshRisk.reasons.slice(0, 3),
        `Execution plan mode=${plan.mode} canBroadcast=${plan.canBroadcast}`,
      ],
    },
    isDemo,
  });

  const consume = order.status === "FILLED" || order.status === "PARTIAL";
  const applied = applyFillToPortfolio(
    state.portfolio,
    state.positions,
    order,
    proposal.symbol,
  );
  if (consume) {
    for (const p of applied.positions) {
      if (p.mint === proposal.mint) {
        p.isDemo = isDemo;
        p.dataSources = proposal.dataSources;
      }
    }
  }

  const accepted: TradeProposal = { ...proposal, status: "ACCEPTED_PAPER" };
  try {
    await db.consumeProposalAndRecordFill({
      proposalId,
      proposal: accepted,
      order,
      snapshot: applied.snapshot,
      positions: applied.positions,
      events: [...events, ...applied.events],
      navUsd: applied.snapshot.navUsd,
      consumeProposal: consume,
    });
  } catch (err) {
    if (err instanceof AlreadyExecutedError) {
      throw err;
    }
    throw err;
  }

  return { order, plan, quote, portfolio: applied.snapshot };
}

export async function markToMarket(db: Database = getDatabase()) {
  const { market } = getProviders();
  const state = await db.getState();
  const marks: Record<string, number> = {};
  for (const p of state.positions) {
    const fromFeed = state.candidates.find((c) => c.mint === p.mint);
    const asset = fromFeed ?? (await market.getAsset(p.mint));
    if (asset?.priceUsd != null) marks[p.mint] = asset.priceUsd;
  }
  const marked = markPositions(state.positions, marks, state.portfolio);
  await db.setPositions(marked.positions);
  await db.setPortfolio(marked.snapshot);
  await db.pushEquity(marked.snapshot.navUsd);
  return marked.snapshot;
}

export async function runFullResearchPass(db: Database = getDatabase()) {
  const { candidates } = await runDiscoveryCycle(db);
  const proposals = [];
  for (const c of candidates.filter((x) => x.symbol !== "SOL").slice(0, 8)) {
    const p = await evaluateMint(c.mint, db);
    if (p) proposals.push(p);
  }
  await generateSmartMoneySignals(db);
  return proposals;
}

export async function runDemoExperiment(db: Database = getDatabase()) {
  const { market } = getProviders();
  const state = await db.getState();
  const start = state.equityHistory[0]?.nav ?? 100_000;
  const equity = state.equityHistory.map((e) => e.nav);
  const demoFromData =
    state.orders.some((o) => o.isDemo) ||
    state.candidates.some((c) => c.isDemo) ||
    market.isDemo;
  const result = runExperimentReplay({
    name: "demo-paper-replay-v1",
    strategyEquity: equity,
    startingCapital: start,
    costDragUsd: state.orders.reduce(
      (s, o) => s + o.spreadCostUsd + o.slippageCostUsd + o.impactCostUsd + o.networkCostUsd,
      0,
    ),
    dataQuality: equity.length < 10 ? "INSUFFICIENT_HISTORY" : "PAPER_EQUITY",
    isDemo: demoFromData,
    dataSource: demoFromData ? "demo" : "paper-equity",
  });
  await db.addExperiment(result);
  return result;
}

export async function getSystemHealth(db: Database = getDatabase()) {
  const state = await db.getState();
  const { market, onchain, execution, research, walletHistory } = getProviders();
  const demoMode = market.isDemo || onchain.isDemo || Boolean(state.candidates.find((c) => c.isDemo));
  const lastDiscovery = state.events.find((e) => e.type === "TOKEN_DISCOVERED")?.timestamp ?? null;
  const lastPaper = state.orders[0]?.createdAt ?? null;
  const providerRows = [
    {
      name: market.name,
      status: market.isDemo ? ("demo_fallback" as const) : ("healthy" as const),
      isDemo: market.isDemo,
      lastSuccessAt: lastDiscovery,
      lastError: null,
      latencyMs: null,
      dataAgeMs: null,
    },
    {
      name: onchain.name,
      status: onchain.isDemo ? ("demo_fallback" as const) : ("healthy" as const),
      isDemo: onchain.isDemo,
      lastSuccessAt: lastDiscovery,
      lastError: null,
      latencyMs: null,
      dataAgeMs: null,
    },
    {
      name: execution.name,
      status: execution.isDemo ? ("demo_fallback" as const) : ("healthy" as const),
      isDemo: execution.isDemo,
      lastSuccessAt: lastPaper,
      lastError: null,
      latencyMs: null,
      dataAgeMs: null,
    },
  ];
  for (const p of providerRows) setProviderHealth(p);
  const status = overallStatus(providerRows);
  return {
    operatingMode: getOperatingMode(),
    liveTradingAllowed: isLiveTradingAllowed(),
    canBroadcast: false as const,
    persistence: db.mode,
    databaseStatus: db.mode === "postgres" ? "postgres" : "memory",
    parseErrors: state.parseErrors,
    demoMode,
    healthStatus: status,
    publicDemo: isPublicDemo(),
    marketDataProvider: market.name,
    onChainProvider: onchain.name,
    researchProvider: process.env.OPENAI_API_KEY ? "openai-compatible" : "mock",
    executionProvider: execution.name,
    lastDiscoveryRun: lastDiscovery,
    lastPaperExecution: lastPaper,
    lastEvaluationRun: state.proposals[0]?.createdAt ?? null,
    candidates: state.candidates.length,
    proposals: state.proposals.length,
    openPositions: state.positions.length,
    orders: state.orders.length,
    events: state.events.length,
    navUsd: state.portfolio.navUsd,
    drawdownPct: state.portfolio.drawdownPct,
    providers: {
      market: market.name,
      marketIsDemo: market.isDemo,
      onchain: onchain.name,
      onchainIsDemo: onchain.isDemo,
      execution: execution.name,
      executionIsDemo: execution.isDemo,
      research: process.env.OPENAI_API_KEY ? "openai-compatible" : "mock",
      researchIsMock: !process.env.OPENAI_API_KEY,
      researchName: research.constructor?.name ?? "research",
      walletHistory: walletHistory.name,
      walletHistoryIsDemo: walletHistory.isDemo,
    },
    providerHealth: providerRows,
  };
}
