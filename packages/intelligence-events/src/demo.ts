import { INTELLIGENCE_EVENT_VERSION, IntelligenceEventSchema, type IntelligenceEvent } from "./index";

/** Synthetic example for UI and query demos; no real wallet or market observation. */
export function demoIntelligenceEvents(): IntelligenceEvent[] {
  return [IntelligenceEventSchema.parse({
    id: "demo-wallet-migration-001",
    version: INTELLIGENCE_EVENT_VERSION,
    type: "WALLET_MIGRATION",
    chain: "SOLANA",
    asset: "demo-destination-mint",
    timestamp: "2026-09-24T10:05:00.000Z",
    score: null,
    confidence: null,
    severity: "INFO",
    metrics: { uniqueWallets: 3, clusterAdjustedWallets: 2, netCapitalUsd: null },
    evidence: [
      { source: "synthetic-fixture", sourceId: "demo-sell-001", observedAt: "2026-09-24T10:00:00.000Z" },
      { source: "synthetic-fixture", sourceId: "demo-buy-001", observedAt: "2026-09-24T10:03:00.000Z" },
    ],
    provenance: { provider: "synthetic-fixture", datasetVersion: "demo-v1", algorithmVersion: "illustrative-only", isDemo: true },
    strategyVersion: null,
    dataQuality: "DEMO",
  })];
}
