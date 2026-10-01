import { afterEach, describe, expect, it } from "vitest";
import { handleV1 } from "../apps/web/src/lib/api-v1";
import { isMonitorOnly, mutatingRequestDenied, operatorAuthorized, productionAuthDenied } from "../apps/web/src/lib/request-guard";
import { GET as getState, POST as postState } from "../apps/web/src/app/api/state/route";
import { getDatabase, resetDatabaseForTests } from "@sat/database";
import { AlertEngine, InternalAlertProvider, StubExternalAlertProvider } from "@sat/alerts";
import { consumeQuota, resetQuotaForTests } from "@sat/entitlements";
import { rateLimitAllow, resetObservabilityForTests } from "@sat/observability";
import { getDemoCandidates, isLiveTradingAllowed, newId, nowIso, type AlertRule } from "@sat/shared";
import { DEMO_WALLETS } from "@sat/wallet-intel";
import { getPersistentAlertEngine } from "@sat/pipeline";

const original = {
  nodeEnv: process.env.NODE_ENV,
  apiKeys: process.env.SAT_API_KEYS,
  apiToken: process.env.SAT_API_TOKEN,
  publicDemo: process.env.PUBLIC_DEMO,
  bindHost: process.env.SAT_BIND_HOST,
  monitorOnly: process.env.SENTINEL_MONITOR_ONLY,
  paperResearch: process.env.SENTINEL_ENABLE_PAPER_RESEARCH,
  demoMode: process.env.DEMO_MODE,
};

afterEach(() => {
  for (const [key, value] of Object.entries({
    NODE_ENV: original.nodeEnv,
    SAT_API_KEYS: original.apiKeys,
    SAT_API_TOKEN: original.apiToken,
    PUBLIC_DEMO: original.publicDemo,
    SAT_BIND_HOST: original.bindHost,
    SENTINEL_MONITOR_ONLY: original.monitorOnly,
    SENTINEL_ENABLE_PAPER_RESEARCH: original.paperResearch,
    DEMO_MODE: original.demoMode,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetQuotaForTests();
  resetObservabilityForTests();
});

function req(headers: Record<string, string> = {}) {
  return new Request("http://127.0.0.1:4317/api/v1/entitlements", { headers });
}

describe("production API guard", () => {
  it("fails closed without configured credentials", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.SAT_API_KEYS;
    delete process.env.SAT_API_TOKEN;
    expect(productionAuthDenied(req())?.code).toBe("AUTH_UNAVAILABLE");
    const response = await handleV1(req({ "x-sentinel-tier": "ADVANCED" }), ["entitlements"]);
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("AUTH_UNAVAILABLE");
  });

  it("requires a server-configured key and ignores tier and forwarding headers", async () => {
    process.env.NODE_ENV = "production";
    process.env.SAT_API_KEYS = "test-secret:PRO";
    delete process.env.SAT_API_TOKEN;
    const headers = { "x-sentinel-tier": "ADVANCED", "x-forwarded-for": "1.2.3.4" };
    const rejected = await handleV1(req(headers), ["entitlements"]);
    expect(rejected.status).toBe(401);
    const accepted = await handleV1(req({ ...headers, authorization: "Bearer test-secret" }), ["entitlements"]);
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).data.entitlements.tier).toBe("PRO");
  });

  it("does not grant global operator actions to a FREE API key", async () => {
    process.env.NODE_ENV = "production";
    process.env.SAT_API_KEYS = "free-client:FREE";
    process.env.SAT_API_TOKEN = "operator-secret";
    delete process.env.PUBLIC_DEMO;
    const keyHeaders = { authorization: "Bearer free-client", host: "127.0.0.1:4317", origin: "http://127.0.0.1:4317" };
    expect(operatorAuthorized(req(keyHeaders))).toBe(false);
    expect((await handleV1(req(keyHeaders), ["entitlements"])).status).toBe(200);
    expect((await getState(req(keyHeaders))).status).toBe(401);
    const reset = new Request("http://127.0.0.1:4317/api/state", {
      method: "POST", headers: keyHeaders, body: JSON.stringify({ action: "reset" }),
    });
    expect((await postState(reset)).status).toBe(401);
    const analyze = new Request(`http://127.0.0.1:4317/api/v1/wallet/${DEMO_WALLETS.SMART_A}`, {
      method: "POST", headers: keyHeaders,
    });
    expect((await handleV1(analyze, ["wallet", DEMO_WALLETS.SMART_A, "score"])).status).toBe(200);
    expect(productionAuthDenied(req(keyHeaders), true)?.code).toBe("UNAUTHORIZED");
    delete process.env.SAT_API_TOKEN;
    expect((await getState(req(keyHeaders))).status).toBe(503);
  });

  it("defaults production to monitor-only and allows monitoring actions", async () => {
    process.env.NODE_ENV = "production";
    process.env.SAT_API_TOKEN = "operator-secret";
    process.env.SAT_API_KEYS = "free-client:FREE";
    delete process.env.PUBLIC_DEMO;
    delete process.env.SENTINEL_MONITOR_ONLY;
    delete process.env.SENTINEL_ENABLE_PAPER_RESEARCH;
    delete process.env.DEMO_MODE;
    const operatorHeaders = { authorization: "Bearer operator-secret", host: "127.0.0.1:4317", origin: "http://127.0.0.1:4317" };
    const keyHeaders = { authorization: "Bearer free-client", host: "127.0.0.1:4317", origin: "http://127.0.0.1:4317" };
    expect(isMonitorOnly()).toBe(true);
    const state = await getState(req(operatorHeaders));
    expect((await state.json()).monitorOnly).toBe(true);
    const bootstrap = new Request("http://127.0.0.1:4317/api/state", {
      method: "POST", headers: operatorHeaders, body: JSON.stringify({ action: "bootstrap" }),
    });
    const blocked = await postState(bootstrap);
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).code).toBe("MONITOR_ONLY");
    const operatorRequest = new Request("http://127.0.0.1:4317/api/state", { method: "POST", headers: operatorHeaders });
    for (const action of ["discover", "research_pass", "experiment", "reset", "evaluate", "paper_execute", "backtest", "mark"] as const) {
      expect(mutatingRequestDenied(operatorRequest, action)?.code).toBe("MONITOR_ONLY");
    }
    const mint = getDemoCandidates()[0]!.mint;
    const evaluate = new Request(`http://127.0.0.1:4317/api/v1/evaluate/${mint}`, { method: "POST", headers: keyHeaders });
    const v1Blocked = await handleV1(evaluate, ["evaluate", mint]);
    expect(v1Blocked.status).toBe(403);
    expect((await v1Blocked.json()).code).toBe("MONITOR_ONLY");
    const backtest = new Request("http://127.0.0.1:4317/api/v1/backtests", { method: "POST", headers: keyHeaders, body: "{}" });
    const backtestBlocked = await handleV1(backtest, ["backtests"]);
    expect(backtestBlocked.status).toBe(403);
    expect((await backtestBlocked.json()).code).toBe("MONITOR_ONLY");
    expect(mutatingRequestDenied(new Request("http://127.0.0.1:4317/api/state", { method: "POST", headers: operatorHeaders }), "alert_create")).toBeNull();
    const analyze = new Request(`http://127.0.0.1:4317/api/v1/wallet/${DEMO_WALLETS.SMART_A}`, { method: "POST", headers: keyHeaders });
    expect((await handleV1(analyze, ["wallet", DEMO_WALLETS.SMART_A, "score"])).status).toBe(200);
    expect(isLiveTradingAllowed()).toBe(false);
  });

  it("requires explicit production demo mode even when paper research is enabled", () => {
    process.env.NODE_ENV = "production";
    process.env.SAT_API_TOKEN = "operator-secret";
    process.env.SENTINEL_ENABLE_PAPER_RESEARCH = "true";
    delete process.env.SENTINEL_MONITOR_ONLY;
    delete process.env.DEMO_MODE;
    const request = new Request("http://127.0.0.1:4317/api/state", {
      method: "POST", headers: { authorization: "Bearer operator-secret", host: "127.0.0.1:4317", origin: "http://127.0.0.1:4317" },
    });
    expect(isMonitorOnly()).toBe(false);
    expect(mutatingRequestDenied(request, "bootstrap")?.code).toBe("DEMO_MODE_REQUIRED");
    expect(mutatingRequestDenied(request, "evaluate")).toBeNull();
    process.env.DEMO_MODE = "true";
    expect(mutatingRequestDenied(request, "bootstrap")).toBeNull();
    process.env.SENTINEL_MONITOR_ONLY = "true";
    expect(mutatingRequestDenied(request, "bootstrap")?.code).toBe("MONITOR_ONLY");
  });

  it("never grants client-selected tiers in local development", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.SAT_API_KEYS;
    delete process.env.SAT_API_TOKEN;
    const response = await handleV1(req({ "x-sentinel-tier": "ADVANCED" }), ["entitlements"]);
    expect((await response.json()).data.entitlements.tier).toBe("FREE");
  });

  it("state GET leaves an empty demo store unchanged", async () => {
    process.env.NODE_ENV = "test";
    process.env.PUBLIC_DEMO = "true";
    delete process.env.SAT_API_KEYS;
    delete process.env.SAT_API_TOKEN;
    resetDatabaseForTests();
    const db = getDatabase();
    const before = await db.getState();
    const response = await getState(req());
    expect(response.status).toBe(200);
    const after = await db.getState();
    expect(after.candidates).toEqual(before.candidates);
    expect(after.experiments).toEqual(before.experiments);
    expect(after.walletScores).toEqual(before.walletScores);
    expect(after.sentinelSignals).toEqual(before.sentinelSignals);
  });

  it("state and V1 alert reads include events committed by another process", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.SAT_API_KEYS;
    delete process.env.SAT_API_TOKEN;
    resetDatabaseForTests();
    const db = getDatabase();
    const cached = await getPersistentAlertEngine(db);
    expect(cached.listHistory()).toEqual([]);
    const event = {
      id: newId(), ruleId: newId(), trigger: "PRICE_BREAKOUT" as const,
      channel: "INTERNAL" as const, title: "External monitor", body: "Saved elsewhere",
      payload: {}, delivered: true, suppressedReason: null, createdAt: nowIso(), isDemo: false,
    };
    await db.addAlertEvents([event]);
    expect(cached.listHistory()).toEqual([]);
    const stateResponse = await getState(req());
    expect((await stateResponse.json()).alertEvents).toMatchObject([{ id: event.id }]);
    const v1Response = await handleV1(req(), ["alerts"]);
    expect((await v1Response.json()).data.events).toMatchObject([{ id: event.id }]);
  });

  it("permits explicit local demo bootstrap while other anonymous writes stay blocked", () => {
    process.env.NODE_ENV = "test";
    process.env.PUBLIC_DEMO = "true";
    process.env.SAT_BIND_HOST = "127.0.0.1";
    delete process.env.SAT_API_TOKEN;
    const request = new Request("http://127.0.0.1:4317/api/state", {
      method: "POST", headers: { host: "127.0.0.1:4317", origin: "http://127.0.0.1:4317" },
    });
    expect(mutatingRequestDenied(request, "bootstrap")).toBeNull();
    expect(mutatingRequestDenied(request, "reset")?.code).toBe("PUBLIC_DEMO_READONLY");
    process.env.SAT_BIND_HOST = "0.0.0.0";
    expect(mutatingRequestDenied(request, "bootstrap")?.code).toBe("PUBLIC_DEMO_READONLY");
  });

  it("V1 GET signals and wallet endpoints read persisted data without seeding it", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.SAT_API_KEYS;
    delete process.env.SAT_API_TOKEN;
    resetDatabaseForTests();
    const db = getDatabase();
    const mint = getDemoCandidates()[0]!.mint;
    expect((await handleV1(req(), ["signals"])).status).toBe(200);
    expect((await handleV1(req(), ["wallets"])).status).toBe(200);
    expect((await handleV1(req(), ["token", mint, "signals"])).status).toBe(200);
    const missing = await handleV1(req(), ["wallet", mint, "score"]);
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe("NOT_FOUND");
    const state = await db.getState();
    expect(state.sentinelSignals).toEqual([]);
    expect(state.walletScores).toEqual([]);
  });

  it("analyzes a wallet only through explicit POST, then serves the stored score", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.SAT_API_KEYS;
    delete process.env.SAT_API_TOKEN;
    resetDatabaseForTests();
    const address = DEMO_WALLETS.SMART_A;
    const request = new Request(`http://127.0.0.1:4317/api/v1/wallet/${address}`, {
      method: "POST", headers: { host: "127.0.0.1:4317", origin: "http://127.0.0.1:4317" },
    });
    expect((await handleV1(request, ["wallet", address, "score"])).status).toBe(200);
    const stored = await handleV1(req(), ["wallet", address, "score"]);
    expect(stored.status).toBe(200);
    expect((await stored.json()).data.score.address).toBe(address);
  });
});

describe("bounded local counters", () => {
  it("fails closed when active rate and quota subject maps reach their caps", () => {
    for (let i = 0; i < 10_000; i++) {
      expect(rateLimitAllow(`subject-${i}`, 1, 0)).toBe(true);
      expect(consumeQuota(`subject-${i}`, 1).ok).toBe(true);
    }
    expect(rateLimitAllow("overflow", 1, 0)).toBe(false);
    expect(consumeQuota("overflow", 1).ok).toBe(false);
  });
});

function rule(channel: AlertRule["channel"]): AlertRule {
  return {
    id: newId(), name: "test", trigger: "SENTINEL_SCORE_CROSS", channel,
    threshold: null, mint: null, wallet: null, cooldownMinutes: 30,
    quietHoursUtc: null, enabled: true, createdAt: "2026-01-01T00:00:00.000Z", isDemo: true,
  };
}

describe("alert delivery recovery", () => {
  it("records unsupported external delivery as failed without an internal fallback", async () => {
    const inbox = new InternalAlertProvider();
    const engine = new AlertEngine([inbox, new StubExternalAlertProvider("EMAIL")]);
    engine.upsertRule(rule("EMAIL"));
    const first = await engine.emit({ trigger: "SENTINEL_SCORE_CROSS", title: "Alert", body: "Body" });
    const second = await engine.emit({ trigger: "SENTINEL_SCORE_CROSS", title: "Alert", body: "Body" });
    expect(first[0]?.delivered).toBe(false);
    expect(first[0]?.suppressedReason).toMatch(/not configured/);
    expect(second[0]?.suppressedReason).toMatch(/not configured/);
    expect(inbox.inbox).toHaveLength(0);
  });

  it("restores rules and delivered cooldown from persisted history", async () => {
    const at = new Date("2026-01-01T12:00:00.000Z");
    const original = new AlertEngine([new InternalAlertProvider()], () => at);
    original.upsertRule(rule("INTERNAL"));
    const events = await original.emit({ trigger: "SENTINEL_SCORE_CROSS", title: "Alert", body: "Body" });
    const restored = new AlertEngine([new InternalAlertProvider()], () => at);
    restored.restoreRules(original.listRules());
    restored.restoreHistory(events);
    const next = await restored.emit({ trigger: "SENTINEL_SCORE_CROSS", title: "Alert", body: "Body" });
    expect(next[0]?.suppressedReason).toBe("cooldown");
  });

  it("rolls back an unpersisted internal event so a retry can deliver", async () => {
    const inbox = new InternalAlertProvider();
    const engine = new AlertEngine([inbox]);
    engine.upsertRule(rule("INTERNAL"));
    let writes = 0;
    engine.setEventRecorder(async () => { if (++writes === 1) throw new Error("storage unavailable"); });
    const event = { trigger: "SENTINEL_SCORE_CROSS" as const, title: "Alert", body: "Body", isDemo: true };
    await expect(engine.emit(event)).rejects.toThrow(/storage unavailable/);
    expect(engine.listHistory()).toHaveLength(0);
    expect(inbox.inbox).toHaveLength(0);
    const retried = await engine.emit(event);
    expect(retried[0]?.delivered).toBe(true);
    expect(inbox.inbox[0]?.delivered).toBe(true);
    expect((await engine.emit(event))[0]?.suppressedReason).toBe("cooldown");
  });

  it("uses the durable recorder result as delivery truth across engine instances", async () => {
    const at = new Date("2026-01-01T12:00:00.000Z");
    const firstInbox = new InternalAlertProvider();
    const secondInbox = new InternalAlertProvider();
    const first = new AlertEngine([firstInbox], () => at);
    const second = new AlertEngine([secondInbox], () => at);
    const sharedRule = rule("INTERNAL");
    first.upsertRule(sharedRule);
    second.upsertRule(sharedRule);
    const claimed = new Set<string>();
    const recorder = async (event: Awaited<ReturnType<typeof first.emit>>[number], cooldown?: { key: string; expiresAt: string }) => {
      if (!cooldown) return event;
      if (claimed.has(cooldown.key)) return { ...event, delivered: false, suppressedReason: "cooldown" };
      claimed.add(cooldown.key);
      expect(Date.parse(cooldown.expiresAt)).toBeGreaterThan(at.getTime());
      return event;
    };
    first.setEventRecorder(recorder);
    second.setEventRecorder(recorder);
    const input = { trigger: "SENTINEL_SCORE_CROSS" as const, title: "Alert", body: "Body", isDemo: true };
    expect((await first.emit(input))[0]?.delivered).toBe(true);
    const duplicate = (await second.emit(input))[0];
    expect(duplicate).toMatchObject({ delivered: false, suppressedReason: "cooldown" });
    expect(second.listHistory()[0]).toEqual(duplicate);
    expect(secondInbox.inbox).toHaveLength(0);
    expect(firstInbox.inbox).toHaveLength(1);
  });

  it("restores the oldest inbox event when persistence fails at capacity", async () => {
    const inbox = new InternalAlertProvider();
    const engine = new AlertEngine([inbox]);
    engine.upsertRule({ ...rule("INTERNAL"), cooldownMinutes: 0 });
    const event = { trigger: "SENTINEL_SCORE_CROSS" as const, title: "Alert", body: "Body", isDemo: true };
    for (let i = 0; i < 500; i++) await engine.emit({ ...event, title: `Alert ${i}` });
    const oldest = inbox.inbox[499];
    engine.setEventRecorder(async () => { throw new Error("storage unavailable"); });
    await expect(engine.emit(event)).rejects.toThrow(/storage unavailable/);
    expect(inbox.inbox).toHaveLength(500);
    expect(inbox.inbox[499]).toEqual(oldest);
    expect(engine.listHistory(1000)).toHaveLength(500);
  });

  it("requires configured mint, wallet, threshold, and demo scope to match", async () => {
    const engine = new AlertEngine([new InternalAlertProvider()]);
    const filtered = { ...rule("INTERNAL"), mint: getDemoCandidates()[0]!.mint,
      wallet: DEMO_WALLETS.SMART_A, threshold: 50, isDemo: false };
    engine.upsertRule(filtered);
    const base = { trigger: filtered.trigger, title: "Alert", body: "Body" };
    expect(await engine.emit({ ...base, isDemo: false })).toEqual([]);
    expect(await engine.emit({ ...base, mint: filtered.mint, isDemo: false })).toEqual([]);
    expect(await engine.emit({ ...base, mint: filtered.mint, wallet: filtered.wallet, isDemo: false })).toEqual([]);
    expect(await engine.emit({ ...base, mint: filtered.mint, wallet: filtered.wallet, value: Number.NaN, isDemo: false })).toEqual([]);
    expect(await engine.emit({ ...base, mint: filtered.mint, wallet: filtered.wallet, value: 80, isDemo: true })).toEqual([]);
    expect((await engine.emit({ ...base, mint: filtered.mint, wallet: filtered.wallet, value: 80, isDemo: false }))[0]?.delivered).toBe(true);
  });

  it("bounds the internal inbox and respects cooldowns longer than a day", async () => {
    let time = Date.parse("2026-01-01T00:00:00Z");
    const inbox = new InternalAlertProvider();
    const engine = new AlertEngine([inbox], () => new Date(time));
    engine.upsertRule({ ...rule("INTERNAL"), cooldownMinutes: 48 * 60 });
    const input = { trigger: "SENTINEL_SCORE_CROSS" as const, title: "Alert", body: "Body", isDemo: true };
    expect((await engine.emit(input))[0]?.delivered).toBe(true);
    time += 25 * 60 * 60_000;
    expect((await engine.emit(input))[0]?.suppressedReason).toBe("cooldown");
    time += 24 * 60 * 60_000;
    expect((await engine.emit(input))[0]?.delivered).toBe(true);

    const many = new AlertEngine([inbox], () => new Date(time));
    many.upsertRule({ ...rule("INTERNAL"), cooldownMinutes: 0 });
    for (let i = 0; i < 501; i++) await many.emit(input);
    expect(inbox.inbox).toHaveLength(500);
    expect(many.listHistory(1000)).toHaveLength(500);
  });

  it("suppresses new cooldown keys at capacity and admits them after expiry", async () => {
    let time = Date.parse("2026-01-01T00:00:00Z");
    const engine = new AlertEngine([new InternalAlertProvider()], () => new Date(time));
    engine.upsertRule({ ...rule("INTERNAL"), cooldownMinutes: 1 });
    const input = { trigger: "SENTINEL_SCORE_CROSS" as const, title: "Alert", body: "Body", isDemo: true };
    for (let i = 0; i < 10_000; i++) {
      expect((await engine.emit({ ...input, wallet: `synthetic-${i}` }))[0]?.delivered).toBe(true);
    }
    expect((await engine.emit({ ...input, wallet: "overflow" }))[0]?.suppressedReason).toBe("cooldown-capacity");
    time += 61_000;
    expect((await engine.emit({ ...input, wallet: "overflow" }))[0]?.delivered).toBe(true);
  }, 30_000);
});
