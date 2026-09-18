import { timingSafeEqual } from "node:crypto";
import { type EntitlementTier, type Entitlements } from "@sat/shared";

export type { EntitlementTier, Entitlements };

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

export interface ApiPrincipal {
  keyId: string;
  tier: EntitlementTier;
}

function timingEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}

/**
 * SAT_API_KEYS="demo_free:FREE,demo_pro:PRO"
 * Unset → unauthenticated FREE (local/dev). Set → Bearer must match.
 */
export function parseApiKeys(raw = process.env.SAT_API_KEYS): Array<{ secret: string; tier: EntitlementTier }> {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const [secret, tierRaw] = part.split(":");
      if (!secret) return [];
      return [{ secret, tier: parseTier(tierRaw) }];
    });
}

export function resolveApiPrincipal(authorization: string | null | undefined): ApiPrincipal | null {
  if (!authorization) return null;
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : authorization.trim();
  if (!token) return null;
  for (const row of parseApiKeys()) {
    if (timingEqual(token, row.secret)) {
      return { keyId: `key_${row.tier.toLowerCase()}_${row.secret.slice(0, 4)}`, tier: row.tier };
    }
  }
  return null;
}

const dailyCounts = new Map<string, { day: string; used: number }>();

export function consumeQuota(subject: string, limit: number): { ok: boolean; used: number; remaining: number } {
  const day = new Date().toISOString().slice(0, 10);
  const cur = dailyCounts.get(subject);
  const used = cur && cur.day === day ? cur.used : 0;
  if (used >= limit) return { ok: false, used, remaining: 0 };
  const next = used + 1;
  dailyCounts.set(subject, { day, used: next });
  return { ok: true, used: next, remaining: remainingQuota(next, limit) };
}

export function resetQuotaForTests(): void {
  dailyCounts.clear();
}
