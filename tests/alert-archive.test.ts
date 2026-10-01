import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresDatabase, PostgresTeamStore, PostgresDeliveryStore } from "@sat/database";
import type { AlertEvent } from "@sat/shared";

const candidate = process.env.SENTINEL_TEST_DATABASE_URL?.trim();
const parsed = candidate ? new URL(candidate) : null;
const safe = !!parsed && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
  && /test/i.test(decodeURIComponent(parsed.pathname));
const schema = `sat_alert_archive_${randomUUID().replaceAll("-", "")}`;
const scoped = new URL(candidate ?? "postgres://unused:unused@127.0.0.1:1/sentinel_test");
scoped.searchParams.set("options", `-c search_path=${schema}`);
const scopedUrl = scoped.toString();
const { Pool } = createRequire(new URL("../packages/database/package.json", import.meta.url))("pg");
const old = new Date(Date.now() - 45 * 86_400_000).toISOString();
const event = (id: string, delivered: boolean): AlertEvent => ({
  id, ruleId: "00000000-0000-4000-8000-000000000001", trigger: "TRACKED_WALLET_BUY",
  channel: "INTERNAL", title: "archive test", body: "fixture", payload: {},
  delivered, suppressedReason: delivered ? null : "cooldown", createdAt: old, isDemo: false,
});

describe.skipIf(!safe)("Postgres alert fact archive", () => {
  let created = false;
  beforeAll(async () => {
    const pool = new Pool({ connectionString: candidate! });
    try { await pool.query(`create schema ${schema}`); created = true; } finally { await pool.end(); }
  });
  afterAll(async () => {
    if (!created) return;
    const pool = new Pool({ connectionString: candidate! });
    try { await pool.query(`drop schema ${schema} cascade`); } finally { await pool.end(); }
  });

  it("keeps unscheduled delivered facts hot and replays compressed settled facts exactly", async () => {
    const db = new PostgresDatabase(scopedUrl, 100_000, 2);
    const team = new PostgresTeamStore(scopedUrl);
    const delivery = new PostgresDeliveryStore(scopedUrl);
    const pool = new Pool({ connectionString: scopedUrl });
    const delivered = event(randomUUID(), true), suppressed = event(randomUUID(), false);
    try {
      await db.getState(); await team.init(); await delivery.init();
      const member = await team.provision("archive-member", "a-credential-long-enough-for-the-test");
      await pool.query(`insert into sat_team_destinations(member_id,chat_id,verified_at,enabled)
        values ($1,'123456',now()-interval '60 days',true)`, [member.id]);
      await db.recordAlertEvent(delivered);
      await db.recordAlertEvent(suppressed);
      expect(await db.getAlertFactStats()).toEqual({ hot: 2, capacity: 2, usagePercent: 100 });
      expect(await db.archiveAlertFacts({ olderThan: new Date(Date.now() - 30 * 86_400_000) })).toBe(1);
      expect((await pool.query("select id from sat_alert_event_facts")).rows.map((row: {id: string}) => row.id)).toEqual([delivered.id]);
      expect(await db.recordAlertEvent(suppressed, { key: "invalid", expiresAt: "invalid" })).toEqual(suppressed);
      await db.recordAlertEvent({ ...event(randomUUID(), true), createdAt: new Date().toISOString() });
      await expect(db.recordAlertEvent(event(randomUUID(), true))).rejects.toThrow("ALERT_EVENT_CAPACITY");
      // Existing destination has now been durably scheduled; the queue stores its own event snapshot.
      await pool.query(`insert into sat_team_deliveries(id,event_id,member_id,event,status)
        values ($1,$2,$3,$4::jsonb,'PENDING')`, [randomUUID(), delivered.id, member.id, delivered]);
      expect(await db.archiveAlertFacts({ olderThan: new Date(Date.now() - 30 * 86_400_000) })).toBe(1);
      expect(await db.recordAlertEvent(delivered, { key: "invalid", expiresAt: "invalid" })).toEqual(delivered);
      expect((await pool.query("select count(*)::int n from sat_alert_event_facts")).rows[0].n).toBe(1);
      expect((await db.getAlertFactStats()).usagePercent).toBe(50);
      expect((await pool.query("select count(*)::int n from sat_alert_event_archive")).rows[0].n).toBe(2);
      await db.recordAlertEvent(event(randomUUID(), true));
    } finally {
      await Promise.all([db.close(), team.close(), delivery.close(), pool.end()]);
    }
  });
});
