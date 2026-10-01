import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InMemoryDatabase, PostgresDatabase } from "@sat/database";
import type { AlertCooldown } from "@sat/database";
import type { AlertEvent } from "@sat/shared";

const ruleId = "00000000-0000-4000-8000-000000000001";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const event = (n: number): AlertEvent => ({
  id: id(n), ruleId, trigger: "PRICE_BREAKOUT", channel: "INTERNAL", title: `event-${n}`,
  body: "synthetic test alert", payload: { mint: "11111111111111111111111111111111" },
  delivered: true, suppressedReason: null, createdAt: new Date().toISOString(), isDemo: false,
});
const cooldown = (): AlertCooldown => ({ key: `${ruleId}:mint:wallet`, expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() });

describe("in-memory durable alert semantics", () => {
  it("serializes one delivered event per key, preserves original ID, and clears on reset", async () => {
    const db = new InMemoryDatabase();
    const gate = cooldown();
    const [a, b] = await Promise.all([
      db.recordAlertEvent(event(1), gate), db.recordAlertEvent(event(2), gate),
    ]);
    expect([a, b].filter((saved) => saved.delivered)).toHaveLength(1);
    expect([a, b].filter((saved) => saved.suppressedReason === "cooldown")).toHaveLength(1);
    expect(await db.recordAlertEvent(event(1), { key: "", expiresAt: "invalid" })).toEqual(a);
    expect((await db.getState()).alertEvents).toHaveLength(2);
    await expect(db.recordAlertEvent(event(3), { ...gate, key: " " })).rejects.toThrow("ALERT_INVALID_COOLDOWN");
    await expect(db.recordAlertEvent(event(3), { ...gate, expiresAt: new Date(Date.now() - 1000).toISOString() }))
      .rejects.toThrow("ALERT_INVALID_COOLDOWN");
    await db.reset(100_000);
    expect((await db.recordAlertEvent(event(3), gate)).delivered).toBe(true);
    expect((await db.getState()).alertEvents).toHaveLength(1);
  });

  it("fails closed at fact capacity while preserving existing IDs and the inbox", async () => {
    const db = new InMemoryDatabase(100_000, 2);
    const first = await db.recordAlertEvent(event(10));
    await db.recordAlertEvent(event(11));
    await expect(db.recordAlertEvent(event(12))).rejects.toThrow("ALERT_EVENT_CAPACITY");
    expect(await db.recordAlertEvent(event(10))).toEqual(first);
    expect((await db.getState()).alertEvents.map((row) => row.id)).toEqual([id(11), id(10)]);
    await db.addAlertEvents([event(13)]);
    await expect(db.recordAlertEvent(event(13))).rejects.toThrow("ALERT_EVENT_CAPACITY");
    expect(() => new InMemoryDatabase(100_000, 100_001)).toThrow("ALERT_EVENT_CAPACITY_INVALID");
  });
});

// Opt in only to the disposable loopback test database; each run uses its own schema.
const candidate = process.env.SENTINEL_TEST_DATABASE_URL?.trim();
const parsed = candidate ? new URL(candidate) : null;
const localTestDatabase = !!parsed && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
  && /test/i.test(decodeURIComponent(parsed.pathname));

describe.skipIf(!localTestDatabase)("Postgres durable alert cooldown", () => {
  const schema = `sat_alert_${randomUUID().replaceAll("-", "")}`;
  const scoped = new URL(candidate ?? "postgres://unused:unused@127.0.0.1:1/sentinel_test");
  scoped.searchParams.set("options", `-c search_path=${schema}`);
  const scopedUrl = scoped.toString();
  const { Pool } = createRequire(new URL("../packages/database/package.json", import.meta.url))("pg");
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

  it("allows only one delivered event across instances and preserves other intel fields", async () => {
    const a = new PostgresDatabase(scopedUrl);
    const b = new PostgresDatabase(scopedUrl);
    const gate = cooldown();
    try {
      await Promise.all([a.getState(), b.getState()]);
      const [one, two] = await Promise.all([
        a.recordAlertEvent(event(1), gate), b.recordAlertEvent(event(2), gate),
      ]);
      expect([one, two].filter((saved) => saved.delivered)).toHaveLength(1);
      expect([one, two].filter((saved) => saved.suppressedReason === "cooldown")).toHaveLength(1);
      const duplicate = await b.recordAlertEvent(event(1), { key: "", expiresAt: "invalid" });
      expect(duplicate).toEqual(one);
      await Promise.all([
        a.setWatchlist([{ id: id(90), kind: "MINT", address: "11111111111111111111111111111111", addedAt: new Date().toISOString() }]),
        b.recordAlertEvent(event(3), gate),
      ]);
      const state = await a.getState();
      expect(state.watchlist).toHaveLength(1);
      expect(state.alertEvents).toHaveLength(3);
      expect(state.alertEvents.filter((saved) => saved.delivered)).toHaveLength(1);
    } finally { await Promise.all([a.close(), b.close()]); }
  });

  it("keeps the gate and event ID after inbox rotation and process reopen", async () => {
    const db = new PostgresDatabase(scopedUrl);
    const gate = cooldown();
    try {
      for (let n = 100; n < 601; n += 1) await db.recordAlertEvent({ ...event(n), delivered: false }, undefined);
      const state = await db.getState();
      expect(state.alertEvents).toHaveLength(500);
      expect(state.alertEvents.some((saved) => saved.id === id(1))).toBe(false);
    } finally { await db.close(); }
    const reopened = new PostgresDatabase(scopedUrl);
    try {
      const old = await reopened.recordAlertEvent(event(1), gate);
      expect(old.id).toBe(id(1));
      const next = await reopened.recordAlertEvent(event(601), gate);
      expect(next).toMatchObject({ delivered: false, suppressedReason: "cooldown" });
      expect((await reopened.getState()).alertEvents).toHaveLength(500);
    } finally { await reopened.close(); }
  });

  it("suppresses delivery when the cooldown key index is at capacity", async () => {
    const db = new PostgresDatabase(scopedUrl);
    const pool = new Pool({ connectionString: scopedUrl });
    try {
      await pool.query(`insert into sat_alert_cooldowns (k, expires_at)
        select 'capacity-' || g, now() + interval '1 day' from generate_series(1, 10000) as g`);
      const result = await db.recordAlertEvent(event(602), { key: "new-key", expiresAt: new Date(Date.now() + 60_000).toISOString() });
      expect(result).toMatchObject({ delivered: false, suppressedReason: "cooldown-capacity" });
    } finally { await Promise.all([db.close(), pool.end()]); }
  });

  it("clears cooldown keys and event IDs with the portfolio reset", async () => {
    const db = new PostgresDatabase(scopedUrl);
    try {
      await db.reset(100_000);
      const fresh = await db.recordAlertEvent(event(1), cooldown());
      expect(fresh.delivered).toBe(true);
      expect((await db.getState()).alertEvents).toHaveLength(1);
    } finally { await db.close(); }
  });

  it("bounds durable facts under the intel lock, including history backfill", async () => {
    const db = new PostgresDatabase(scopedUrl, 100_000, 2);
    try {
      await db.reset(100_000);
      const first = await db.recordAlertEvent(event(700));
      await db.recordAlertEvent(event(701));
      await expect(db.recordAlertEvent(event(702))).rejects.toThrow("ALERT_EVENT_CAPACITY");
      expect(await db.recordAlertEvent(event(700))).toEqual(first);
      await db.addAlertEvents([event(703)]);
      await expect(db.recordAlertEvent(event(703))).rejects.toThrow("ALERT_EVENT_CAPACITY");
      expect((await db.getState()).alertEvents.map((row) => row.id)).toEqual([id(703), id(701), id(700)]);
    } finally { await db.close(); }
  });
});
