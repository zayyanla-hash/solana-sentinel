import { type EntitlementTier, type Entitlements } from "@sat/shared";

/**
 * Prices live in docs/monetization.md — never in core gating logic.
 * Map a tier (from billing/x402/API key) onto capabilities.
 */
export const TIER_ENTITLEMENTS: Record<EntitlementTier, Entitlements> = {
  FREE: {
    tier: "FREE",
    realtimeAlerts: false,
    advancedSignals: false,
    walletIntelligence: true,
    walletClustering: false,
    strategyLab: false,
    maxWatchlist: 5,
    maxBacktestsPerDay: 3,
    apiQuotaPerDay: 50,
    delayedFeedMinutes: 15,
  },
  PRO: {
    tier: "PRO",
    realtimeAlerts: true,
    advancedSignals: true,
    walletIntelligence: true,
    walletClustering: false,
    strategyLab: true,
    maxWatchlist: 50,
    maxBacktestsPerDay: 40,
    apiQuotaPerDay: 2_000,
    delayedFeedMinutes: 0,
  },
  ADVANCED: {
    tier: "ADVANCED",
    realtimeAlerts: true,
    advancedSignals: true,
    walletIntelligence: true,
    walletClustering: true,
    strategyLab: true,
    maxWatchlist: 250,
    maxBacktestsPerDay: 200,
    apiQuotaPerDay: 20_000,
    delayedFeedMinutes: 0,
  },
  API: {
    tier: "API",
    realtimeAlerts: true,
    advancedSignals: true,
    walletIntelligence: true,
    walletClustering: true,
    strategyLab: true,
    maxWatchlist: 250,
    maxBacktestsPerDay: 200,
    apiQuotaPerDay: 10_000,
    delayedFeedMinutes: 0,
  },
};

export function entitlementsFor(tier: EntitlementTier): Entitlements {
  return TIER_ENTITLEMENTS[tier];
}

export function parseTier(raw: string | undefined | null): EntitlementTier {
  const v = (raw ?? "FREE").trim().toUpperCase();
  if (v === "PRO" || v === "ADVANCED" || v === "API") return v;
  return "FREE";
}

export function assertEntitled(e: Entitlements, feature: keyof Entitlements): void {
  const val = e[feature];
  if (val === false) {
    throw new Error(`ENTITLEMENT_DENIED:${String(feature)}`);
  }
}

export function remainingQuota(used: number, limit: number): number {
  return Math.max(0, limit - used);
}
