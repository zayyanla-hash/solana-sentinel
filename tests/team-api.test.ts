import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresDatabase, PostgresDeliveryStore, PostgresTeamStore, getTeamStore } from "@sat/database";
import type { AlertEvent } from "@sat/shared";

const candidate = process.env.SENTINEL_TEST_DATABASE_URL?.trim();
const parsed = candidate ? new URL(candidate) : null;
const localTestDatabase = !!parsed && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
  && /test/i.test(decodeURIComponent(parsed.pathname));

describe.skipIf(!localTestDatabase)("shared team API authorization", () => {
  const schema = `sat_team_api_${randomUUID().replaceAll("-", "")}`;
  const scoped = new URL(candidate ?? "postgres://unused:unused@127.0.0.1:1/sentinel_test");
  scoped.searchParams.set("options", `-c search_path=${schema}`);
  const scopedUrl = scoped.toString();
  const origin = "https://sentinel.example.test";
  const previous: Record<string, string | undefined> = {};
  const { Pool } = createRequire(new URL("../packages/database/package.json", import.meta.url))("pg");
  const pool = new Pool({ connectionString: candidate });
  const scopedPool = new Pool({ connectionString: scopedUrl });
  let created = false;
  let team: PostgresTeamStore;
  let ownerId = "";
  let peerId = "";
  let ownerCookie = "";
  let peerCookie = "";
  let route: typeof import("../apps/web/src/app/api/team/[action]/route");

  function request(action: string, options: { method?: "GET" | "POST"; cookie?: string; origin?: string; authorization?: string; body?: unknown } = {}): Request {
    const headers: Record<string, string> = {};
    if (options.cookie) headers.cookie = options.cookie;
    if (options.origin) headers.origin = options.origin;
    if (options.authorization) headers.authorization = options.authorization;
    if (options.method === "POST") headers["content-type"] = "application/json";
    return new Request(`${origin}/api/team/${action}`, {
      method: options.method ?? "GET", headers,
      body: options.method === "POST" ? JSON.stringify(options.body ?? {}) : undefined,
    });
  }

  beforeAll(async () => {
    await pool.query(`create schema ${schema}`); created = true;
    for (const key of ["DATABASE_URL", "SENTINEL_TEAM_MODE", "SAT_PUBLIC_ORIGIN", "SAT_CONFIG_KEY", "SAT_API_KEYS", "SAT_API_TOKEN"]) {
      previous[key] = process.env[key];
    }
    process.env.DATABASE_URL = scopedUrl;
    process.env.SENTINEL_TEAM_MODE = "true";
    process.env.SAT_PUBLIC_ORIGIN = origin;
    process.env.SAT_CONFIG_KEY = randomBytes(32).toString("hex");
    process.env.SAT_API_KEYS = "subscriber:test-key";
    process.env.SAT_API_TOKEN = "operator-not-a-team-session";
    team = new PostgresTeamStore(scopedUrl);
    ownerId = (await team.provision("owner", "owner-password-long-enough-123456")).id;
    peerId = (await team.provision("peer", "peer-password-long-enough-654321")).id;
    route = await import("../apps/web/src/app/api/team/[action]/route");
    const ownerLogin = await route.POST(request("login", { method: "POST", origin,
      body: { username: "owner", credential: "owner-password-long-enough-123456" } }));
    expect(ownerLogin.status).toBe(200);
    ownerCookie = ownerLogin.headers.get("set-cookie")!.split(";")[0]!;
    const peerLogin = await route.POST(request("login", { method: "POST", origin,
      body: { username: "peer", credential: "peer-password-long-enough-654321" } }));
    expect(peerLogin.status).toBe(200);
    peerCookie = peerLogin.headers.get("set-cookie")!.split(";")[0]!;
  });

  afterAll(async () => {
    await Promise.all([team?.close(), getTeamStore().close(), scopedPool.end()]);
    if (created) await pool.query(`drop schema ${schema} cascade`);
    await pool.end();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  it("requires team sessions, rejects subscriber and operator keys, and blocks hostile origins", async () => {
    expect((await route.GET(request("status"))).status).toBe(401);
    expect((await route.GET(request("status", { authorization: "Bearer test-key" }))).status).toBe(401);
    expect((await route.GET(request("status", { authorization: "Bearer operator-not-a-team-session" }))).status).toBe(401);
    expect((await route.POST(request("member", { method: "POST", origin, authorization: "Bearer test-key",
      body: { username: "intruder" } }))).status).toBe(401);
    expect((await route.POST(request("member", { method: "POST", origin: "https://evil.example", cookie: ownerCookie,
      body: { username: "intruder" } }))).status).toBe(403);
    expect((await route.POST(request("member", { method: "POST", cookie: ownerCookie,
      body: { username: "intruder" } }))).status).toBe(403);
    const status = await route.GET(request("status", { cookie: ownerCookie }));
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ member: { id: ownerId, username: "owner" } });
  });

  it("does not let a member retry the other member's Telegram delivery", async () => {
    const db = new PostgresDatabase(scopedUrl);
    const delivery = new PostgresDeliveryStore(scopedUrl);
    const alert: AlertEvent = { id: randomUUID(), ruleId: randomUUID(), trigger: "TRACKED_WALLET_BUY",
      channel: "INTERNAL", title: "Live buy", body: "test event", payload: {}, delivered: true,
      suppressedReason: null, createdAt: new Date(Date.now() + 1000).toISOString(), isDemo: false };
    try {
      await db.getState();
      const { challenge } = await delivery.beginDestinationVerification(peerId, "123456789");
      await delivery.verifyDestination(peerId, challenge);
      await db.recordAlertEvent(alert);
      await delivery.reconcileFacts();
      const queued = (await delivery.listDeliveries(peerId)).find((d) => d.eventId === alert.id)!;
      const claim = (await delivery.claimDue()).find((d) => d.id === queued.id)!;
      await delivery.finishSend(claim.id, claim.leaseToken, { kind: "failed", reason: "DESTINATION_FORBIDDEN" });
      const response = await route.POST(request("retry-delivery", { method: "POST", origin, cookie: ownerCookie, body: { id: queued.id } }));
      expect([403, 404]).toContain(response.status);
      expect((await delivery.listDeliveries(peerId)).find((d) => d.id === queued.id)?.status).toBe("FAILED");
      expect((await route.GET(request("status", { cookie: ownerCookie })).then((r) => r.json()) as { deliveries: { id: string }[] }).deliveries
        .some((d) => d.id === queued.id)).toBe(false);
    } finally { await Promise.all([db.close(), delivery.close()]); }
  });

  it("expires sessions and rate limits login attempts", async () => {
    const rawToken = peerCookie.split("=")[1]!;
    const digest = createHash("sha256").update(rawToken).digest("hex");
    await scopedPool.query("update sat_team_sessions set expires_at = now() - interval '1 second' where hash = $1", [digest]);
    expect((await route.GET(request("status", { cookie: peerCookie }))).status).toBe(401);
    expect((await route.POST(request("destination-enabled", { method: "POST", origin, cookie: peerCookie,
      body: { enabled: false } }))).status).toBe(401);
    await scopedPool.query(`insert into sat_team_login_limits(id,attempts,reset_at) values('global',30,now()+interval '5 minutes')
      on conflict(id) do update set attempts=30,reset_at=excluded.reset_at`);
    expect((await route.POST(request("login", { method: "POST", origin,
      body: { username: "unknown", credential: "irrelevant" } }))).status).toBe(429);
  });
});
