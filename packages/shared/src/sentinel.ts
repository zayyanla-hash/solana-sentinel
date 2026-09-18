import { z } from "zod";
import { SolanaAddressSchema } from "./schemas";

/** Health of a provider or the whole system. DEMO is never equivalent to healthy live data. */
export const HealthStatusSchema = z.enum(["healthy", "degraded", "demo_fallback", "unavailable"]);
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

export const ProviderHealthSchema = z.object({
  name: z.string(),
  status: HealthStatusSchema,
  isDemo: z.boolean(),
  lastSuccessAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  latencyMs: z.number().nonnegative().nullable(),
  dataAgeMs: z.number().nonnegative().nullable(),
});
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;

export class QuoteProviderError extends Error {
  readonly code = "QUOTE_PROVIDER_ERROR";
  readonly provider: string;
  readonly status: HealthStatus;
  constructor(provider: string, message: string, status: HealthStatus = "unavailable") {
    super(message);
    this.name = "QuoteProviderError";
    this.provider = provider;
    this.status = status;
  }
}

export const WalletTradeSchema = z.object({
  signature: z.string().min(1).max(128),
  timestamp: z.string().datetime(),
  mint: SolanaAddressSchema,
  side: z.enum(["BUY", "SELL", "TRANSFER_IN", "TRANSFER_OUT", "AIRDROP", "UNKNOWN"]),
  usdNotional: z.number().nonnegative(),
  qty: z.number(),
  priceUsd: z.number().nonnegative().nullable(),
  tokenAgeHoursAtEntry: z.number().nonnegative().nullable(),
  liquidityUsdAtEntry: z.number().nonnegative().nullable(),
  slippageBps: z.number().nullable(),
  counterparty: SolanaAddressSchema.nullable().optional(),
  isDemo: z.boolean().default(false),
  sourceSignature: z.string().max(128).optional(),
  provider: z.string().optional(),
  classificationConfidence: z.number().min(0).max(1).optional(),
  priceSource: z.string().nullable().optional(),
  priceAsOf: z.string().datetime().nullable().optional(),
  costBasis: z.enum(["PRICED", "UNPRICED", "PARTIAL", "UNKNOWN"]).optional(),
});
export type WalletTrade = z.infer<typeof WalletTradeSchema>;

export const WalletPerformanceSchema = z.object({
  realizedPnlUsd: z.number().nullable(),
  unrealizedPnlUsd: z.number().nullable(),
  winRate: z.number().min(0).max(1).nullable(),
  lossRate: z.number().min(0).max(1).nullable(),
  averageWinnerUsd: z.number().nullable(),
  averageLoserUsd: z.number().nullable(),
  expectancyUsd: z.number().nullable(),
  profitFactor: z.number().nullable(),
  medianReturnPct: z.number().nullable(),
  maxDrawdownPct: z.number().nullable(),
  consistency: z.number().min(0).max(1).nullable(),
  tradeCount: z.number().int().nonnegative(),
  sampleSize: z.number().int().nonnegative(),
});
export type WalletPerformance = z.infer<typeof WalletPerformanceSchema>;

export const WalletBehaviorSchema = z.object({
  medianHoldingHours: z.number().nullable(),
  turnover: z.number().nullable(),
  tradesPerDay: z.number().nullable(),
  typicalPositionUsd: z.number().nullable(),
  preferredMarketCapUsd: z.number().nullable(),
  concentrationHhi: z.number().nullable(),
  avgTokenAgeHoursAtEntry: z.number().nullable(),
  avgLiquidityUsdAtEntry: z.number().nullable(),
  avgSlippageBps: z.number().nullable(),
});
export type WalletBehavior = z.infer<typeof WalletBehaviorSchema>;

export const WalletRiskProfileSchema = z.object({
  rugExposure: z.number().min(0).max(1).nullable(),
  scamExposure: z.number().min(0).max(1).nullable(),
  failedTokenExposure: z.number().min(0).max(1).nullable(),
  illiquidTokenExposure: z.number().min(0).max(1).nullable(),
  concentrationRisk: z.number().min(0).max(1).nullable(),
  suspiciousTransferScore: z.number().min(0).max(1).nullable(),
  walletAgeDays: z.number().nullable(),
  fundingSourceFlags: z.array(z.string()).default([]),
});
export type WalletRiskProfile = z.infer<typeof WalletRiskProfileSchema>;

export const WalletCredibilityScoreSchema = z.object({
  address: SolanaAddressSchema,
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  sampleSize: z.number().int().nonnegative(),
  reasonCodes: z.array(z.string()),
  positiveEvidence: z.array(z.string()),
  negativeEvidence: z.array(z.string()),
  dataFreshness: z.enum(["FRESH", "STALE", "INSUFFICIENT", "DEMO"]),
  performance: WalletPerformanceSchema,
  behavior: WalletBehaviorSchema,
  risk: WalletRiskProfileSchema,
  assessedAt: z.string().datetime(),
  configVersion: z.string(),
  isDemo: z.boolean(),
  neverGuaranteed: z.literal(true),
});
export type WalletCredibilityScore = z.infer<typeof WalletCredibilityScoreSchema>;

export const ClusterLabelSchema = z.enum([
  "POSSIBLE_CLUSTER",
  "RELATED_ACTIVITY",
  "COMMON_FUNDER",
  "COORDINATED_TIMING",
]);
export type ClusterLabel = z.infer<typeof ClusterLabelSchema>;

export const WalletGraphEdgeSchema = z.object({
  from: SolanaAddressSchema,
  to: z.string().min(1),
  kind: z.enum(["TRANSFER", "FUNDING", "CO_TRADE", "CREATOR", "TRANSACTION"]),
  weight: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
  labels: z.array(ClusterLabelSchema),
  evidence: z.array(z.string()),
  isDemo: z.boolean().default(false),
});
export type WalletGraphEdge = z.infer<typeof WalletGraphEdgeSchema>;

export const WalletClusterSchema = z.object({
  id: z.string(),
  wallets: z.array(SolanaAddressSchema),
  labels: z.array(ClusterLabelSchema),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()),
  isDemo: z.boolean(),
  ownershipClaimed: z.literal(false),
});
export type WalletCluster = z.infer<typeof WalletClusterSchema>;

export const SentinelSignalTypeSchema = z.enum([
  "HIGH_CREDIBILITY_ACCUMULATION",
  "HIGH_CREDIBILITY_DISTRIBUTION",
  "MULTI_WALLET_ENTRY",
  "SMART_CONCENTRATION_INCREASE",
  "NEW_MARKET_ENTRY",
  "RETURNING_WALLET",
  "MARKET_CONFIRMED_FLOW",
]);
export type SentinelSignalType = z.infer<typeof SentinelSignalTypeSchema>;

export const SentinelSignalSchema = z.object({
  id: z.string().uuid(),
  asset: SolanaAddressSchema,
  symbol: z.string(),
  timestamp: z.string().datetime(),
  signalType: SentinelSignalTypeSchema,
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  walletEvidence: z.array(z.string()),
  marketEvidence: z.array(z.string()),
  tokenRisk: z.string(),
  liquidityRisk: z.string(),
  explanation: z.array(z.string()),
  invalidationConditions: z.array(z.string()),
  provenance: z.array(z.string()),
  isDemo: z.boolean(),
  analogues: z
    .array(
      z.object({
        id: z.string(),
        symbol: z.string(),
        signalType: z.string(),
        similarity: z.number().min(0).max(1),
        paperOutcome: z.enum(["WIN", "LOSS", "FLAT", "UNKNOWN", "INSUFFICIENT"]),
        note: z.string(),
        isDemo: z.boolean(),
      }),
    )
    .default([]),
});
export type SentinelSignal = z.infer<typeof SentinelSignalSchema>;

export const WatchlistItemSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["MINT", "WALLET"]),
  address: SolanaAddressSchema,
  label: z.string().max(64).optional(),
  addedAt: z.string().datetime(),
});
export type WatchlistItem = z.infer<typeof WatchlistItemSchema>;

export const ApiPrincipalSchema = z.object({
  keyId: z.string(),
  tier: z.enum(["FREE", "PRO", "ADVANCED", "API"]),
});
export type ApiPrincipal = z.infer<typeof ApiPrincipalSchema>;

export const StrategyLabConfigSchema = z.object({
  version: z.string(),
  liquidityFloorUsd: z.number().nonnegative(),
  minTokenAgeHours: z.number().nonnegative(),
  minWalletCredibility: z.number().min(0).max(100),
  minConfirmingWallets: z.number().int().nonnegative(),
  momentumThreshold: z.number(),
  volumeThreshold: z.number(),
  maxTokenRiskScore: z.number().min(0).max(100),
  maxVolatility: z.number().nonnegative(),
  positionSizeUsd: z.number().positive(),
  stopLossPct: z.number().min(0).max(1),
  takeProfitPct: z.number().min(0).max(5),
  trailingExitPct: z.number().min(0).max(1).nullable(),
  maxHoldingBars: z.number().int().positive(),
  cooldownBars: z.number().int().nonnegative(),
  maxPortfolioExposurePct: z.number().min(0).max(1),
  datasetVersion: z.string(),
});
export type StrategyLabConfig = z.infer<typeof StrategyLabConfigSchema>;

export const DEFAULT_STRATEGY_LAB_CONFIG: StrategyLabConfig = {
  version: "strategy-lab-v1",
  liquidityFloorUsd: 250_000,
  minTokenAgeHours: 24,
  minWalletCredibility: 60,
  minConfirmingWallets: 2,
  momentumThreshold: 0.15,
  volumeThreshold: 0.2,
  maxTokenRiskScore: 55,
  maxVolatility: 0.12,
  positionSizeUsd: 2_500,
  stopLossPct: 0.08,
  takeProfitPct: 0.18,
  trailingExitPct: 0.06,
  maxHoldingBars: 48,
  cooldownBars: 6,
  maxPortfolioExposurePct: 0.4,
  datasetVersion: "demo-ohlcv-v1",
};

export const AlertChannelSchema = z.enum(["INTERNAL", "WEB_PUSH", "TELEGRAM", "DISCORD", "EMAIL"]);
export type AlertChannel = z.infer<typeof AlertChannelSchema>;

export const AlertTriggerSchema = z.enum([
  "SENTINEL_SCORE_CROSS",
  "TRACKED_WALLET_BUY",
  "TRACKED_WALLET_SELL",
  "MULTI_WALLET_ACCUMULATION",
  "LIQUIDITY_SPIKE",
  "HOLDER_CHANGE",
  "TOKEN_RISK_DOWNGRADE",
  "TOKEN_RISK_IMPROVEMENT",
  "PRICE_BREAKOUT",
  "VOLUME_ACCELERATION",
  "PORTFOLIO_DRAWDOWN",
  "PAPER_ENTRY",
  "PAPER_EXIT",
]);
export type AlertTrigger = z.infer<typeof AlertTriggerSchema>;

export const AlertRuleSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80),
  trigger: AlertTriggerSchema,
  channel: AlertChannelSchema,
  threshold: z.number().nullable(),
  mint: SolanaAddressSchema.nullable(),
  wallet: SolanaAddressSchema.nullable(),
  cooldownMinutes: z.number().int().nonnegative().default(30),
  quietHoursUtc: z.tuple([z.number().int().min(0).max(23), z.number().int().min(0).max(23)]).nullable(),
  enabled: z.boolean().default(true),
  createdAt: z.string().datetime(),
  isDemo: z.boolean().default(true),
});
export type AlertRule = z.infer<typeof AlertRuleSchema>;

export const AlertEventSchema = z.object({
  id: z.string().uuid(),
  ruleId: z.string().uuid(),
  trigger: AlertTriggerSchema,
  channel: AlertChannelSchema,
  title: z.string(),
  body: z.string(),
  payload: z.record(z.unknown()).default({}),
  delivered: z.boolean(),
  suppressedReason: z.string().nullable(),
  createdAt: z.string().datetime(),
  isDemo: z.boolean(),
});
export type AlertEvent = z.infer<typeof AlertEventSchema>;

export const EntitlementTierSchema = z.enum(["FREE", "PRO", "ADVANCED", "API"]);
export type EntitlementTier = z.infer<typeof EntitlementTierSchema>;

export const EntitlementsSchema = z.object({
  tier: EntitlementTierSchema,
  realtimeAlerts: z.boolean(),
  advancedSignals: z.boolean(),
  walletIntelligence: z.boolean(),
  walletClustering: z.boolean(),
  strategyLab: z.boolean(),
  maxWatchlist: z.number().int().nonnegative(),
  maxBacktestsPerDay: z.number().int().nonnegative(),
  apiQuotaPerDay: z.number().int().nonnegative(),
  delayedFeedMinutes: z.number().int().nonnegative(),
});
export type Entitlements = z.infer<typeof EntitlementsSchema>;

export const UsageRecordSchema = z.object({
  id: z.string().uuid(),
  subject: z.string(),
  action: z.string(),
  units: z.number().nonnegative(),
  estimatedCostUsd: z.number().nonnegative().nullable(),
  provider: z.string().nullable(),
  at: z.string().datetime(),
});
export type UsageRecord = z.infer<typeof UsageRecordSchema>;

export const BacktestTradeSchema = z.object({
  mint: z.string(),
  side: z.enum(["BUY", "SELL"]),
  barIndex: z.number().int().nonnegative(),
  timestamp: z.number().int().nonnegative(),
  price: z.number(),
  qty: z.number(),
  usd: z.number(),
  reason: z.string(),
  costsUsd: z.number().nonnegative(),
});
export type BacktestTrade = z.infer<typeof BacktestTradeSchema>;

export const BacktestResultSchema = z.object({
  id: z.string().uuid(),
  strategyVersion: z.string(),
  datasetVersion: z.string(),
  config: StrategyLabConfigSchema,
  equity: z.array(z.number()),
  benchmarkEquity: z.array(z.number()),
  trades: z.array(BacktestTradeSchema),
  metrics: z
    .object({
      totalReturnPct: z.number(),
      maxDrawdownPct: z.number(),
      sharpe: z.number().nullable(),
      sortino: z.number().nullable(),
      winRate: z.number().nullable(),
      profitFactor: z.number().nullable(),
      expectancy: z.number().nullable(),
      turnover: z.number(),
      tradeCount: z.number().int().nonnegative(),
      feeDragUsd: z.number(),
      sampleSize: z.number().int().nonnegative(),
    })
    .nullable(),
  warnings: z.array(z.string()),
  dataCoverage: z.object({
    bars: z.number().int().nonnegative(),
    interval: z.string(),
    startMs: z.number().int().nullable(),
    endMs: z.number().int().nullable(),
  }),
  walkForward: z
    .object({
      trainBars: z.number().int(),
      validationBars: z.number().int(),
      testBars: z.number().int(),
      oosReturnPct: z.number().nullable(),
    })
    .nullable(),
  isDemo: z.boolean(),
  label: z.enum(["PAPER", "BACKTEST", "DEMO"]),
  createdAt: z.string().datetime(),
});
export type BacktestResult = z.infer<typeof BacktestResultSchema>;
