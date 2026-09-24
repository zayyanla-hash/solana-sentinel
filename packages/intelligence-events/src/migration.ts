import { INTELLIGENCE_EVENT_VERSION, IntelligenceEventSchema, type IntelligenceEvent } from "./index";

/** Narrow structural interface; the wallet module remains independently deployable. */
export interface MigrationEventSource {
  id: string;
  sourceMint: string;
  destinationMint: string;
  lastTransitionAt: string;
  transitionCount: number;
  uniqueWalletCount: number;
  clusterAdjustedCount: number;
  migrationVelocityWalletsPerHour: number;
  repeatPenalty: number;
  estimatedMigratedNotionalUsd: number | null;
  valuationQuality: "COMPLETE" | "PARTIAL" | "MISSING";
  isDemo: boolean;
  evidence: Array<{
    signature: string;
    timestamp: string;
    side: "SELL" | "BUY";
    mint: string;
    provider: string | null;
  }>;
}

export function eventFromWalletMigration(
  migration: MigrationEventSource,
  origin: { provider: string; datasetVersion: string; algorithmVersion: string },
): IntelligenceEvent {
  return IntelligenceEventSchema.parse({
    id: `wallet-migration:${migration.id}`,
    version: INTELLIGENCE_EVENT_VERSION,
    type: "WALLET_MIGRATION",
    chain: "SOLANA",
    asset: migration.destinationMint,
    timestamp: migration.lastTransitionAt,
    score: null,
    confidence: null,
    severity: "INFO",
    metrics: {
      sourceMint: migration.sourceMint,
      transitionCount: migration.transitionCount,
      uniqueWallets: migration.uniqueWalletCount,
      clusterAdjustedWallets: migration.clusterAdjustedCount,
      arrivalVelocityWalletsPerHour: migration.migrationVelocityWalletsPerHour,
      repeatPenalty: migration.repeatPenalty,
      estimatedMigratedNotionalUsd: migration.estimatedMigratedNotionalUsd,
    },
    evidence: migration.evidence.map((leg) => ({
      source: leg.provider || origin.provider,
      sourceId: leg.signature,
      observedAt: leg.timestamp,
      detail: `${leg.side} ${leg.mint}`,
    })),
    provenance: { ...origin, isDemo: migration.isDemo },
    strategyVersion: null,
    // Valuation coverage alone cannot establish complete wallet-history coverage.
    dataQuality: migration.isDemo ? "DEMO" : migration.valuationQuality === "MISSING" ? "INSUFFICIENT" : "PARTIAL",
  });
}
