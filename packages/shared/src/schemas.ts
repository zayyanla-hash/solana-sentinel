import { z } from "zod";

/** Operating modes — LIVE is gated and never default. */
export const OperatingModeSchema = z.enum(["DEMO", "PAPER", "READ_ONLY", "LIVE"]);
export type OperatingMode = z.infer<typeof OperatingModeSchema>;

export const RiskTierSchema = z.enum([
  "LOWER_RISK",
  "ELEVATED_RISK",
  "HIGH_RISK",
  "INSUFFICIENT_DATA",
]);
export type RiskTier = z.infer<typeof RiskTierSchema>;

export const PolicyDecisionSchema = z.enum(["APPROVED", "REJECTED", "MANUAL_REVIEW"]);
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

export const RiskDecisionSchema = z.enum(["APPROVE", "REJECT", "REDUCE_SIZE"]);
export type RiskDecision = z.infer<typeof RiskDecisionSchema>;

export const MarketRegimeSchema = z.enum([
  "RISK_ON",
  "NEUTRAL",
  "RISK_OFF",
  "HIGH_VOLATILITY",
]);
export type MarketRegime = z.infer<typeof MarketRegimeSchema>;

export const SystemEventTypeSchema = z.enum([
  "TOKEN_DISCOVERED",
  "TOKEN_REJECTED",
  "SIGNAL_GENERATED",
  "TRADE_PROPOSED",
  "POLICY_REJECTED",
  "RISK_REJECTED",
  "PAPER_ORDER_CREATED",
  "PAPER_ORDER_FILLED",
  "POSITION_OPENED",
  "POSITION_CLOSED",
  "POSITION_UPDATED",
  "PROVIDER_ERROR",
  "SYSTEM_ERROR",
  "WALLET_SCORED",
  "ALERT_EMITTED",
  "BACKTEST_COMPLETED",
  "STREAM_STATUS",
  "USAGE_RECORDED",
]);
export type SystemEventType = z.infer<typeof SystemEventTypeSchema>;

export const SolanaAddressSchema = z
  .string()
  .min(32)
  .max(44)
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, "Invalid base58 address");

export const CandidateAssetSchema = z.object({
  mint: SolanaAddressSchema,
  symbol: z.string().min(1).max(32),
  name: z.string().min(1).max(128),
  timestamp: z.string().datetime(),
  priceUsd: z.number().nonnegative().nullable(),
  marketCapUsd: z.number().nonnegative().nullable(),
  liquidityUsd: z.number().nonnegative().nullable(),
  volume24hUsd: z.number().nonnegative().nullable(),
  volumeChange24hPct: z.number().nullable(),
  priceChange1hPct: z.number().nullable(),
  priceChange24hPct: z.number().nullable(),
  priceChange7dPct: z.number().nullable(),
  tokenAgeHours: z.number().nonnegative().nullable(),
  holderCount: z.number().int().nonnegative().nullable(),
  decimals: z.number().int().min(0).max(18).nullable(),
  metadata: z.record(z.unknown()).default({}),
  dataSources: z.array(z.string()).default([]),
  riskFlags: z.array(z.string()).default([]),
  isDemo: z.boolean().default(false),
});
export type CandidateAsset = z.infer<typeof CandidateAssetSchema>;

export const OhlcvIntervalSchema = z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]);
export type OhlcvInterval = z.infer<typeof OhlcvIntervalSchema>;

/** Provider-agnostic OHLCV bar. `timestamp` is Unix epoch milliseconds. */
export const OhlcvBarSchema = z
  .object({
    timestamp: z.number().int().nonnegative(),
    open: z.number().finite(),
    high: z.number().finite(),
    low: z.number().finite(),
    close: z.number().finite(),
    volume: z.number().nonnegative().finite(),
  })
  .refine((b) => b.high >= b.low, { message: "high must be >= low" });
export type OhlcvBar = z.infer<typeof OhlcvBarSchema>;

export const SignalNameSchema = z.enum([
  "momentum",
  "volume",
  "liquidity",
  "relative_strength",
  "volatility",
  "market_regime",
  "on_chain",
  "trend_breakout",
]);
export type SignalName = z.infer<typeof SignalNameSchema>;

export const SignalResultSchema = z.object({
  name: SignalNameSchema,
  value: z.number(),
  normalizedScore: z.number().min(-1).max(1),
  confidence: z.number().min(0).max(1),
  source: z.string(),
  timestamp: z.string().datetime(),
  meta: z.record(z.unknown()).optional(),
});
export type SignalResult = z.infer<typeof SignalResultSchema>;

export const ArtifactProvenanceSchema = z.object({
  isDemo: z.boolean(),
  dataSources: z.array(z.string()),
  providerNames: z.array(z.string()).default([]),
  configVersions: z.record(z.string()).default({}),
  tokenRiskId: z.string().uuid().optional(),
  policyId: z.string().uuid().optional(),
  researchId: z.string().uuid().optional(),
  scoreId: z.string().uuid().optional(),
});
export type ArtifactProvenance = z.infer<typeof ArtifactProvenanceSchema>;

export const TokenRiskAssessmentSchema = z.object({
  id: z.string().uuid().optional(),
  mint: SolanaAddressSchema,
  riskScore: z.number().min(0).max(100),
  riskTier: RiskTierSchema,
  riskFlags: z.array(z.string()),
  riskReasons: z.array(z.string()),
  dataConfidence: z.number().min(0).max(1),
  details: z.object({
    tokenProgram: z.enum(["TOKEN", "TOKEN_2022", "UNKNOWN"]).default("UNKNOWN"),
    mintAuthority: z.boolean().nullable(),
    freezeAuthority: z.boolean().nullable(),
    permanentDelegate: z.boolean().nullable(),
    transferRestrictions: z.boolean().nullable(),
    topHolderConcentrationPct: z.number().nullable(),
    liquidityUsd: z.number().nullable(),
    exitLiquidityUsd: z.number().nullable(),
    tokenAgeHours: z.number().nullable(),
    metadataQuality: z.number().min(0).max(1).nullable(),
    estimatedPriceImpactPct: z.number().nullable(),
    top5HolderConcentrationPct: z.number().nullable().optional(),
    top10HolderConcentrationPct: z.number().nullable().optional(),
    top20HolderConcentrationPct: z.number().nullable().optional(),
    transferHook: z.boolean().nullable().optional(),
    token2022Extensions: z.array(z.string()).nullable().optional(),
    jupiterVerified: z.boolean().nullable().optional(),
    jupiterOrganicScore: z.number().min(0).max(100).nullable().optional(),
    creatorHoldingPct: z.number().nullable().optional(),
    lpConcentrationPct: z.number().nullable().optional(),
    missingFields: z.array(z.string()).default([]),
  }),
  assessedAt: z.string().datetime(),
  configVersion: z.string(),
});
export type TokenRiskAssessment = z.infer<typeof TokenRiskAssessmentSchema>;

export const PolicyAssessmentSchema = z.object({
  id: z.string().uuid().optional(),
  mint: SolanaAddressSchema,
  decision: PolicyDecisionSchema,
  reasons: z.array(z.string()),
  matchedRules: z.array(z.string()),
  configVersion: z.string(),
  assessedAt: z.string().datetime(),
});
export type PolicyAssessment = z.infer<typeof PolicyAssessmentSchema>;

export const OpportunityScoreSchema = z.object({
  id: z.string().uuid().optional(),
  mint: SolanaAddressSchema,
  compositeScore: z.number().min(0).max(100),
  /** Composite excluding research weight — used for the min_score gate. */
  gateScore: z.number().min(0).max(100).optional(),
  components: z.record(z.number()),
  weights: z.record(z.number()),
  strategyConfigVersion: z.string(),
  explanation: z.array(z.string()),
  signalSources: z.record(z.string()).optional(),
  scoredAt: z.string().datetime(),
});
export type OpportunityScore = z.infer<typeof OpportunityScoreSchema>;

export const ResearchBriefSchema = z.object({
  id: z.string().uuid().optional(),
  mint: SolanaAddressSchema,
  thesis: z.string().max(2000),
  catalysts: z.array(z.string().max(280)).max(8),
  contradictions: z.array(z.string().max(280)).max(8),
  confidence: z.number().min(0).max(1),
  sources: z.array(z.string()).max(16),
  isMock: z.boolean(),
  generatedAt: z.string().datetime(),
  model: z.string().optional(),
  provider: z.string().optional(),
  inputSnapshotRef: z.string().max(512).optional(),
  summary: z.string().max(2000).optional(),
  bullCase: z.array(z.string().max(280)).max(8).optional(),
  bearCase: z.array(z.string().max(280)).max(8).optional(),
  riskFactors: z.array(z.string().max(280)).max(8).optional(),
  unknowns: z.array(z.string().max(280)).max(8).optional(),
  citations: z.array(z.string().max(280)).max(16).optional(),
});
export type ResearchBrief = z.infer<typeof ResearchBriefSchema>;

export const RiskEngineResultSchema = z.object({
  decision: RiskDecisionSchema,
  reasons: z.array(z.string()),
  approvedSizeUsd: z.number().nonnegative(),
  requestedSizeUsd: z.number().nonnegative(),
  checks: z.array(
    z.object({
      name: z.string(),
      passed: z.boolean(),
      detail: z.string(),
    }),
  ),
  configVersion: z.string(),
  assessedAt: z.string().datetime(),
});
export type RiskEngineResult = z.infer<typeof RiskEngineResultSchema>;

export const ExecutionProviderNameSchema = z.enum([
  "jupiter",
  "jupiter-swap-v2",
  "jupiter-ultra-legacy",
  "demo",
]);
export type ExecutionProviderName = z.infer<typeof ExecutionProviderNameSchema>;

export const ExecutionQualitySchema = z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]);
export type ExecutionQuality = z.infer<typeof ExecutionQualitySchema>;

export const ExecutionQuoteSchema = z.object({
  inputMint: SolanaAddressSchema,
  outputMint: SolanaAddressSchema,
  inAmount: z.string(),
  outAmount: z.string(),
  otherAmountThreshold: z.string().optional(),
  priceImpactPct: z.number().nullable(),
  slippageBps: z.number().int().nonnegative(),
  routeLabels: z.array(z.string()).default([]),
  feeEstimateUsd: z.number().nullable(),
  provider: ExecutionProviderNameSchema,
  raw: z.unknown().optional(),
  quotedAt: z.string().datetime(),
  isDemo: z.boolean().default(false),
  router: z.string().nullable().optional(),
  priorityFeeLamports: z.number().nullable().optional(),
  estimatedExecutionQuality: ExecutionQualitySchema.optional(),
  dataAgeMs: z.number().nonnegative().nullable().optional(),
  quoteTimestamp: z.string().datetime().optional(),
});
export type ExecutionQuote = z.infer<typeof ExecutionQuoteSchema>;

export const ExecutionPlanSchema = z.object({
  quote: ExecutionQuoteSchema,
  mode: z.enum(["PAPER", "LIVE_STUB"]),
  canBroadcast: z.literal(false),
  notes: z.array(z.string()),
  plannedAt: z.string().datetime(),
});
export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

export const PaperOrderStatusSchema = z.enum([
  "CREATED",
  "PARTIAL",
  "FILLED",
  "FAILED",
  "STALE_REJECTED",
]);
export type PaperOrderStatus = z.infer<typeof PaperOrderStatusSchema>;

export const PaperOrderSchema = z.object({
  id: z.string().uuid(),
  mint: SolanaAddressSchema,
  side: z.enum(["BUY", "SELL"]),
  requestedUsd: z.number().positive(),
  filledUsd: z.number().nonnegative(),
  filledQty: z.number().nonnegative(),
  avgPriceUsd: z.number().nonnegative().nullable(),
  status: PaperOrderStatusSchema,
  spreadCostUsd: z.number().nonnegative(),
  slippageCostUsd: z.number().nonnegative(),
  impactCostUsd: z.number().nonnegative(),
  networkCostUsd: z.number().nonnegative(),
  latencyMs: z.number().nonnegative(),
  provenance: z.object({
    opportunityScoreId: z.string().optional(),
    riskAssessmentId: z.string().optional(),
    policyAssessmentId: z.string().optional(),
    tokenRiskId: z.string().optional(),
    researchId: z.string().optional(),
    strategyConfigVersion: z.string(),
    riskConfigVersion: z.string(),
    dataSources: z.array(z.string()),
    reasons: z.array(z.string()),
  }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  isDemo: z.boolean().default(true),
});
export type PaperOrder = z.infer<typeof PaperOrderSchema>;

export const PositionSchema = z.object({
  id: z.string().uuid(),
  mint: SolanaAddressSchema,
  symbol: z.string(),
  qty: z.number(),
  avgEntryUsd: z.number().nonnegative(),
  markUsd: z.number().nonnegative(),
  unrealizedPnlUsd: z.number(),
  realizedPnlUsd: z.number(),
  openedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  isDemo: z.boolean().optional(),
  dataSources: z.array(z.string()).optional(),
});
export type Position = z.infer<typeof PositionSchema>;

export const PortfolioSnapshotSchema = z.object({
  timestamp: z.string().datetime(),
  navUsd: z.number(),
  cashUsd: z.number(),
  positionsValueUsd: z.number(),
  drawdownPct: z.number(),
  peakNavUsd: z.number(),
});
export type PortfolioSnapshot = z.infer<typeof PortfolioSnapshotSchema>;

export const TradeProposalSchema = z.object({
  id: z.string().uuid(),
  mint: SolanaAddressSchema,
  symbol: z.string(),
  side: z.enum(["BUY", "SELL"]),
  sizeUsd: z.number().positive(),
  score: OpportunityScoreSchema,
  tokenRisk: TokenRiskAssessmentSchema,
  policy: PolicyAssessmentSchema,
  risk: RiskEngineResultSchema,
  research: ResearchBriefSchema.optional(),
  signals: z.array(SignalResultSchema),
  status: z.enum(["PROPOSED", "REJECTED", "ACCEPTED_PAPER", "MANUAL_REVIEW"]),
  createdAt: z.string().datetime(),
  isDemo: z.boolean().optional(),
  dataSources: z.array(z.string()).optional(),
  provenance: ArtifactProvenanceSchema.optional(),
});
export type TradeProposal = z.infer<typeof TradeProposalSchema>;

export const SystemEventSchema = z.object({
  id: z.string().uuid(),
  type: SystemEventTypeSchema,
  timestamp: z.string().datetime(),
  mint: SolanaAddressSchema.optional(),
  message: z.string(),
  payload: z.record(z.unknown()).default({}),
  configVersions: z.record(z.string()).default({}),
});
export type SystemEvent = z.infer<typeof SystemEventSchema>;

export const StrategyConfigSchema = z.object({
  version: z.string(),
  weights: z.object({
    momentum: z.number(),
    volume: z.number(),
    liquidity: z.number(),
    relativeStrength: z.number(),
    regime: z.number(),
    onChain: z.number(),
    riskReward: z.number(),
    trendBreakout: z.number().default(0.05),
    research: z.number(),
  }),
  minCompositeScore: z.number().min(0).max(100).default(55),
});
export type StrategyConfig = z.infer<typeof StrategyConfigSchema>;

export const RiskConfigSchema = z.object({
  version: z.string(),
  maxPositionUsd: z.number().positive(),
  maxPortfolioExposurePct: z.number().min(0).max(1),
  maxSimultaneousPositions: z.number().int().positive(),
  minLiquidityUsd: z.number().nonnegative(),
  maxPriceImpactPct: z.number().nonnegative(),
  maxSlippageBps: z.number().int().nonnegative(),
  maxDrawdownPct: z.number().min(0).max(1),
  maxTurnoverUsdPerDay: z.number().positive(),
  cooldownMinutes: z.number().nonnegative(),
  minScore: z.number().min(0).max(100),
  capitalFloorUsd: z.number().nonnegative(),
});
export type RiskConfig = z.infer<typeof RiskConfigSchema>;

export const PolicyConfigSchema = z.object({
  version: z.string(),
  spotOnly: z.boolean().default(true),
  allowInterestBearing: z.boolean().default(false),
  allowLeverage: z.boolean().default(false),
  allowDerivatives: z.boolean().default(false),
  allowPredictionMarkets: z.boolean().default(false),
  allowProhibitedBusiness: z.boolean().default(false),
  whitelistMints: z.array(SolanaAddressSchema).default([]),
  blacklistMints: z.array(SolanaAddressSchema).default([]),
  manualReviewMints: z.array(SolanaAddressSchema).default([]),
  prohibitedKeywords: z.array(z.string()).default([
    "casino",
    "gambling",
    "leverage",
    "perp",
    "futures",
    "interest",
    "lending",
    "prediction",
    "polymarket",
  ]),
});
export type PolicyConfig = z.infer<typeof PolicyConfigSchema>;

export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  version: "strategy-v1.1",
  weights: {
    momentum: 0.18,
    volume: 0.13,
    liquidity: 0.13,
    relativeStrength: 0.09,
    regime: 0.09,
    onChain: 0.09,
    riskReward: 0.14,
    trendBreakout: 0.05,
    research: 0.05,
  },
  minCompositeScore: 55,
};

/** Proposal TTL at execute time — stale proposes must be re-evaluated. */
export const PROPOSAL_TTL_MS = 15 * 60_000;

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  version: "risk-v1",
  maxPositionUsd: 5_000,
  maxPortfolioExposurePct: 0.6,
  maxSimultaneousPositions: 8,
  minLiquidityUsd: 250_000,
  maxPriceImpactPct: 1.5,
  maxSlippageBps: 100,
  maxDrawdownPct: 0.15,
  maxTurnoverUsdPerDay: 50_000,
  cooldownMinutes: 30,
  minScore: 55,
  capitalFloorUsd: 10_000,
};

export const DEFAULT_POLICY_CONFIG: PolicyConfig = {
  version: "policy-v1",
  spotOnly: true,
  allowInterestBearing: false,
  allowLeverage: false,
  allowDerivatives: false,
  allowPredictionMarkets: false,
  allowProhibitedBusiness: false,
  whitelistMints: [],
  blacklistMints: [],
  manualReviewMints: [],
  prohibitedKeywords: [
    "casino",
    "gambling",
    "leverage",
    "perp",
    "futures",
    "interest",
    "lending",
    "prediction",
    "polymarket",
  ],
};

/** Hard safety gate — LIVE trading requires explicit multi-gate override. */
export function assertNotLiveBroadcast(mode: OperatingMode): void {
  if (mode === "LIVE") {
    throw new Error(
      "LIVE broadcast is disabled. This platform is READ_ONLY + PAPER ONLY. Set OPERATING_MODE=PAPER.",
    );
  }
}

/**
 * Live broadcast unlock check.
 * Always false in V1: env unlock vars in README are reserved for a future audited path.
 * Do not flip this until broadcast is implemented and independently reviewed.
 */
export function isLiveTradingAllowed(): boolean {
  return false;
}

/** Public portfolio demo: anonymous users are read-only. */
export function isPublicDemo(): boolean {
  const v = (process.env.PUBLIC_DEMO ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}
