import { newId, nowIso, type HealthStatus, type ProviderHealth, type UsageRecord } from "@sat/shared";

export interface StructuredLog {
  level: "info" | "warn" | "error";
  msg: string;
  requestId?: string;
  cycleId?: string;
  signalId?: string;
  provider?: string;
  latencyMs?: number;
  retryCount?: number;
  at: string;
}

const logs: StructuredLog[] = [];
const usage: UsageRecord[] = [];
const providerHealth = new Map<string, ProviderHealth>();

export function requestId(): string {
  return newId();
}

export function logEvent(entry: Omit<StructuredLog, "at">): StructuredLog {
  const row: StructuredLog = { ...entry, at: nowIso() };
  logs.unshift(row);
  if (logs.length > 500) logs.length = 500;
  return row;
}

export function recordUsage(partial: Omit<UsageRecord, "id" | "at">): UsageRecord {
  const row: UsageRecord = { ...partial, id: newId(), at: nowIso() };
  usage.unshift(row);
  if (usage.length > 1000) usage.length = 1000;
  return row;
}

export function setProviderHealth(h: ProviderHealth): void {
  providerHealth.set(h.name, h);
}

export function getProviderHealth(name: string): ProviderHealth | undefined {
  return providerHealth.get(name);
}

export function listProviderHealth(): ProviderHealth[] {
  return [...providerHealth.values()];
}

export function recentLogs(limit = 50): StructuredLog[] {
  return logs.slice(0, limit);
}

export function recentUsage(limit = 50): UsageRecord[] {
  return usage.slice(0, limit);
}

export function usageSummary(): {
  calls: number;
  estimatedCostUsd: number;
  byProvider: Record<string, { calls: number; cost: number }>;
} {
  const byProvider: Record<string, { calls: number; cost: number }> = {};
  let estimatedCostUsd = 0;
  for (const u of usage) {
    estimatedCostUsd += u.estimatedCostUsd ?? 0;
    const key = u.provider ?? "unknown";
    byProvider[key] ??= { calls: 0, cost: 0 };
    byProvider[key].calls += 1;
    byProvider[key].cost += u.estimatedCostUsd ?? 0;
  }
  return { calls: usage.length, estimatedCostUsd, byProvider };
}

export function overallStatus(parts: ProviderHealth[]): HealthStatus {
  if (parts.some((p) => p.status === "unavailable")) return "unavailable";
  if (parts.every((p) => p.isDemo || p.status === "demo_fallback")) return "demo_fallback";
  if (parts.some((p) => p.status === "degraded" || p.status === "demo_fallback")) return "degraded";
  return "healthy";
}

const buckets = new Map<string, { tokens: number; updatedAt: number }>();

export function rateLimitAllow(key: string, capacity = 60, refillPerSec = 1): boolean {
  const now = Date.now();
  const cur = buckets.get(key) ?? { tokens: capacity, updatedAt: now };
  const elapsed = (now - cur.updatedAt) / 1000;
  cur.tokens = Math.min(capacity, cur.tokens + elapsed * refillPerSec);
  cur.updatedAt = now;
  if (cur.tokens < 1) {
    buckets.set(key, cur);
    return false;
  }
  cur.tokens -= 1;
  buckets.set(key, cur);
  return true;
}

export function resetObservabilityForTests(): void {
  logs.length = 0;
  usage.length = 0;
  providerHealth.clear();
  buckets.clear();
}

export type ProductEventName =
  | "signup"
  | "token_analyzed"
  | "wallet_analyzed"
  | "signal_viewed"
  | "alert_created"
  | "watchlist_add"
  | "backtest_started"
  | "backtest_completed"
  | "strategy_saved"
  | "upgrade_viewed"
  | "api_used";

export interface AnalyticsProvider {
  track(event: ProductEventName, props?: Record<string, unknown>): void;
}

class MemoryAnalytics implements AnalyticsProvider {
  readonly events: Array<{ event: ProductEventName; props?: Record<string, unknown>; at: string }> = [];
  track(event: ProductEventName, props?: Record<string, unknown>): void {
    this.events.push({ event, props, at: nowIso() });
    logEvent({ level: "info", msg: `analytics:${event}` });
  }
}

let analytics: AnalyticsProvider = new MemoryAnalytics();

export function getAnalytics(): AnalyticsProvider {
  return analytics;
}

export function setAnalyticsProvider(provider: AnalyticsProvider): void {
  analytics = provider;
}

export { MemoryAnalytics };
