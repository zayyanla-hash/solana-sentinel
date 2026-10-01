import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PostgresDatabase, PostgresDeliveryStore, PostgresTeamStore } from "@sat/database";
import { TelegramClient, formatTelegramAlert } from "@sat/alerts";
import type { AlertEvent } from "@sat/shared";

let member = randomUUID();
let peer = randomUUID();
const event = (id: string, createdAt = new Date().toISOString()): AlertEvent => ({
  id, ruleId: randomUUID(), trigger: "TRACKED_WALLET_BUY", channel: "INTERNAL", title: "Wallet buy",
  body: "A verified wallet bought a token", payload: { wallet: "11111111111111111111111111111111" },
  delivered: true, suppressedReason: null, createdAt, isDemo: false,
});

describe("Telegram API handling", () => {
  const token = `123456789:${"a".repeat(35)}`;
  it("includes a stable event ID and does not use Telegram markup", () => {
    const alert = event(randomUUID());
    expect(formatTelegramAlert(alert)).toContain(`Event ID: ${alert.id}`);
    expect(formatTelegramAlert(alert)).toContain("Wallet buy");
  });

  it("handles successful sends, rate limits, bad credentials, and ambiguous network outcomes", async () => {
    const send = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, parameters: { retry_after: 17 } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, description: "secret" }), { status: 401 }))
      .mockRejectedValueOnce(new Error("network error with token"));
    const client = new TelegramClient(token, send);
    expect(await client.sendAlert("123", event(randomUUID()))).toEqual({ kind: "sent", messageId: 42 });
    expect(await client.sendText("123", "hello")).toEqual({ kind: "retry", reason: "RATE_LIMITED", retryAfterSeconds: 17 });
    expect(await client.sendText("123", "hello")).toEqual({ kind: "failed", reason: "BOT_TOKEN_REJECTED" });
    expect(await client.sendText("123", "hello")).toEqual({ kind: "uncertain", reason: "SEND_OUTCOME_UNKNOWN" });
    const request = send.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({ chat_id: "123", link_preview_options: { is_disabled: true } });
    expect(JSON.parse(String(request.body))).not.toHaveProperty("parse_mode");
  });

  it("verifies a bot token with getMe and redacts upstream failures", async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { id: 123, is_bot: true, username: "sentinel_alert_bot" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, description: `secret ${token}` }), { status: 401 }))
      .mockRejectedValueOnce(new Error(`secret ${token}`));
    const client = new TelegramClient(token, send);
    expect(await client.verifyBot()).toEqual({ id: 123, username: "sentinel_alert_bot" });
    expect(send.mock.calls[0][0]).toBe(`https://api.telegram.org/bot${token}/getMe`);
    await expect(client.verifyBot()).rejects.toThrow("BOT_TOKEN_REJECTED");
    await expect(client.verifyBot()).rejects.toThrow("TELEGRAM_VERIFY_UNAVAILABLE");
    expect(() => new TelegramClient("invalid", send)).toThrow("TELEGRAM_TOKEN_INVALID");
  });
});

const candidate = process.env.SENTINEL_TEST_DATABASE_URL?.trim();
const parsed = candidate ? new URL(candidate) : null;
const localTestDatabase = !!parsed && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
  && /test/i.test(decodeURIComponent(parsed.pathname));

describe.skipIf(!localTestDatabase)("durable Telegram delivery", () => {
  const schema = `sat_delivery_${randomUUID().replaceAll("-", "")}`;
  const scoped = new URL(candidate ?? "postgres://unused:unused@127.0.0.1:1/sentinel_test");
  scoped.searchParams.set("options", `-c search_path=${schema}`);
  const scopedUrl = scoped.toString();
  const { Pool } = createRequire(new URL("../packages/database/package.json", import.meta.url))("pg");
  let created = false;
  let team: PostgresTeamStore;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: candidate! });
    try { await pool.query(`create schema ${schema}`); created = true; } finally { await pool.end(); }
    team = new PostgresTeamStore(scopedUrl);
    member = (await team.provision("owner", "test-owner-credential-long-enough-1234")).id;
    peer = (await team.provision("collaborator", "test-peer-credential-long-enough-5678")).id;
  });
  afterAll(async () => {
    if (!created) return;
    await team.close();
    const pool = new Pool({ connectionString: candidate! });
    try { await pool.query(`drop schema ${schema} cascade`); } finally { await pool.end(); }
  });

  it("verifies a recipient, enqueues later facts once, and preserves uncertain sends for review", async () => {
    const db = new PostgresDatabase(scopedUrl);
    const a = new PostgresDeliveryStore(scopedUrl);
    const b = new PostgresDeliveryStore(scopedUrl);
    try {
      await db.getState();
      const old = event(randomUUID(), new Date(Date.now() - 60_000).toISOString());
      await db.recordAlertEvent(old);
      const { challenge } = await a.beginDestinationVerification(member, "-100123456789");
      await expect(a.verifyDestination(member, "bad")).rejects.toThrow("TELEGRAM_CODE_INVALID");
      await expect(a.verifyDestination(member, "999999" === challenge ? "000000" : "999999"))
        .rejects.toThrow("TELEGRAM_CODE_INVALID");
      const destination = await a.verifyDestination(member, challenge);
      expect(destination).toMatchObject({ verified: true, chatId: "-100123456789" });
      await expect(a.verifyDestination(member, challenge)).rejects.toThrow("TELEGRAM_CODE_EXPIRED");
      expect(await a.reconcileFacts()).toBe(0);

      const fresh = event(randomUUID(), new Date(Date.now() + 1000).toISOString());
      await db.recordAlertEvent(fresh);
      expect((await Promise.all([a.reconcileFacts(), b.reconcileFacts()])).reduce((x, y) => x + y, 0)).toBe(1);
      const [one, two] = await Promise.all([a.claimDue(), b.claimDue()]);
      expect(one.length + two.length).toBe(1);
      const claimed = [...one, ...two][0];
      expect(claimed.event.id).toBe(fresh.id);
      expect(claimed.chatId).toBe("-100123456789");
      expect(await a.finishSend(claimed.id, randomUUID(), { kind: "sent", messageId: 1 })).toBeNull();
      expect(await a.finishSend(claimed.id, claimed.leaseToken, { kind: "uncertain", reason: "SEND_OUTCOME_UNKNOWN" }))
        .toMatchObject({ status: "UNCERTAIN", attempts: 1 });
      expect(await b.claimDue()).toEqual([]);
      expect(await b.manualRetry(claimed.id, member)).toMatchObject({ status: "PENDING", attempts: 0 });
      const replay = (await b.claimDue())[0];
      expect(await b.finishSend(replay.id, replay.leaseToken, { kind: "sent", messageId: 73 }))
        .toMatchObject({ status: "SENT", messageId: 73 });
      expect(await a.reconcileFacts()).toBe(0);
      expect(await a.listDeliveries(member)).toHaveLength(1);
    } finally { await Promise.all([a.close(), b.close(), db.close()]); }
  });

  it("blocks disabled and revoked recipients, and cannot send a pending alert to a replacement chat", async () => {
    const db = new PostgresDatabase(scopedUrl);
    const delivery = new PostgresDeliveryStore(scopedUrl);
    const pool = new Pool({ connectionString: scopedUrl });
    try {
      const { challenge } = await delivery.beginDestinationVerification(peer, "111222333");
      await expect(delivery.beginDestinationVerification(peer, "111222333"))
        .rejects.toThrow("TELEGRAM_VERIFICATION_RATE_LIMITED");
      await delivery.verifyDestination(peer, challenge);
      await delivery.authorizeTest(peer);
      await expect(delivery.authorizeTest(peer)).rejects.toThrow("TELEGRAM_TEST_RATE_LIMITED");

      const first = event(randomUUID(), new Date(Date.now() + 1000).toISOString());
      await db.recordAlertEvent(first);
      await delivery.reconcileFacts();
      expect((await delivery.listDeliveries(peer)).find((d) => d.eventId === first.id)?.status).toBe("PENDING");
      await delivery.setDestinationEnabled(peer, false);
      expect((await delivery.listDeliveries(peer)).find((d) => d.eventId === first.id))
        .toMatchObject({ status: "FAILED", lastError: "DESTINATION_DISABLED" });
      expect((await delivery.claimDue()).filter((d) => d.memberId === peer)).toEqual([]);
      await delivery.setDestinationEnabled(peer, true);
      const second = event(randomUUID(), new Date(Date.now() + 2000).toISOString());
      await db.recordAlertEvent(second);
      await delivery.reconcileFacts();
      expect((await delivery.listDeliveries(peer)).find((d) => d.eventId === second.id)?.status).toBe("PENDING");
      await pool.query(`update sat_team_telegram_limits set last_verification_at = now() - interval '2 minutes' where member_id = $1`, [peer]);
      const replacement = await delivery.beginDestinationVerification(peer, "999888777");
      await delivery.verifyDestination(peer, replacement.challenge);
      expect((await delivery.listDeliveries(peer)).find((d) => d.eventId === second.id))
        .toMatchObject({ status: "FAILED", lastError: "DESTINATION_CHANGED" });
      expect((await delivery.claimDue()).filter((d) => d.memberId === peer)).toEqual([]);
      await team.revoke(peer);
      const third = event(randomUUID(), new Date(Date.now() + 3000).toISOString());
      await db.recordAlertEvent(third);
      await delivery.reconcileFacts();
      expect((await delivery.listDeliveries(peer)).some((d) => d.eventId === third.id)).toBe(false);
    } finally { await Promise.all([delivery.close(), db.close(), pool.end()]); }
  });

  it("marks an expired claim uncertain and allows only its recipient to request a retry", async () => {
    const db = new PostgresDatabase(scopedUrl);
    const delivery = new PostgresDeliveryStore(scopedUrl);
    const pool = new Pool({ connectionString: scopedUrl });
    try {
      const alert = event(randomUUID(), new Date(Date.now() + 4000).toISOString());
      await db.recordAlertEvent(alert);
      await delivery.reconcileFacts();
      const claim = (await delivery.claimDue()).find((d) => d.eventId === alert.id && d.memberId === member)!;
      expect(claim).toBeDefined();
      await pool.query(`update sat_team_deliveries set lease_at = now() - interval '2 minutes' where id = $1`, [claim.id]);
      expect(await delivery.claimDue()).toEqual([]);
      expect((await delivery.listDeliveries(member)).find((d) => d.id === claim.id)?.status).toBe("UNCERTAIN");
      expect(await delivery.manualRetry(claim.id, peer)).toBeNull();
      expect(await delivery.manualRetry(claim.id, member)).toMatchObject({ status: "PENDING", attempts: 0 });
    } finally { await Promise.all([delivery.close(), db.close(), pool.end()]); }
  });

  it("recovers after enqueue without an in-memory queue and stops automatic retries after five attempts", async () => {
    const db = new PostgresDatabase(scopedUrl);
    const firstProcess = new PostgresDeliveryStore(scopedUrl);
    const pool = new Pool({ connectionString: scopedUrl });
    const alert = event(randomUUID(), new Date(Date.now() + 5000).toISOString());
    try {
      await db.recordAlertEvent(alert);
      expect(await firstProcess.reconcileFacts()).toBeGreaterThan(0);
      await pool.query("delete from sat_alert_event_facts where id = $1", [alert.id]);
    } finally { await Promise.all([firstProcess.close(), db.close()]); }
    const restarted = new PostgresDeliveryStore(scopedUrl);
    try {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const claim = (await restarted.claimDue()).find((d) => d.eventId === alert.id && d.memberId === member)!;
        expect(claim.event.id).toBe(alert.id);
        const result = await restarted.finishSend(claim.id, claim.leaseToken,
          { kind: "retry", reason: "RATE_LIMITED", retryAfterSeconds: 1 });
        expect(result?.status).toBe(attempt === 5 ? "FAILED" : "RETRYING");
        await pool.query(`update sat_team_deliveries set next_attempt_at = now() - interval '1 second' where id = $1`, [claim.id]);
      }
      expect((await restarted.claimDue()).some((d) => d.eventId === alert.id && d.memberId === member)).toBe(false);
    } finally { await Promise.all([restarted.close(), pool.end()]); }
  });
});
