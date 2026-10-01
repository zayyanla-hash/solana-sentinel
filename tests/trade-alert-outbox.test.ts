import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { InMemoryDatabase, PostgresDatabase, PostgresIngestionStore, type ChainObservation } from "@sat/database";
import { createAlertRule, dispatchPendingTradeAlerts } from "@sat/pipeline";
import type { AlertRule, WalletTrade } from "@sat/shared";

const wallet = "11111111111111111111111111111111";
const mint = "So11111111111111111111111111111111111111112";
const signature = (n: number) => `${"1".repeat(63)}${"23456789ABCDEFGHJKLMNPQRSTUVWXYZ"[n]}`;
const rule = (id: string, channel: AlertRule["channel"] = "INTERNAL"): AlertRule => ({
  id, name: "Live buys", trigger: "TRACKED_WALLET_BUY", channel, threshold: null, mint: null, wallet,
  cooldownMinutes: 60, quietHoursUtc: null, enabled: true, createdAt: new Date(Date.now() - 60_000).toISOString(), isDemo: false,
});
const observation = (n: number): ChainObservation => {
  const trade: WalletTrade = { signature: `leg-${n}`, sourceSignature: signature(n),
    timestamp: new Date(Date.now() - 5_000 + n * 1000).toISOString(), mint, side: "BUY", usdNotional: 0,
    qty: 2, priceUsd: null, tokenAgeHoursAtEntry: null, liquidityUsdAtEntry: null, slippageBps: null,
    isDemo: false, provider: "solana-finalized-rpc-v1" };
  return { wallet, signature: signature(n), slot: 100 + n, blockTime: 1_700_000_000 + n,
    outcome: "CLASSIFIED", reason: "test", raw: { slot: 100 + n }, trades: [trade] };
};
const next = { anchor: signature(0), target: null, before: null, coverage: "CURRENT" as const,
  lastSuccessAt: new Date().toISOString(), lastError: null };
const candidate = process.env.SENTINEL_TEST_DATABASE_URL?.trim();
const parsed = candidate ? new URL(candidate) : null;
const local = !!parsed && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
  && /test/i.test(decodeURIComponent(parsed.pathname));

describe("operator tracked-alert configuration", () => {
  it("creates live tracked rules for a configured journal while preserving demo score rules", async () => {
    vi.stubEnv("SAT_WALLET_HISTORY_SOURCE", "journal");
    vi.stubEnv("DATABASE_URL", "postgresql://unused@127.0.0.1/sentinel_stage");
    try {
      const db = new InMemoryDatabase();
      const live = await createAlertRule({ name: "Wallet buys", trigger: "TRACKED_WALLET_BUY",
        createdAt: new Date(Date.now() - 60_000).toISOString() }, db);
      expect(live.isDemo).toBe(false);
      expect((await createAlertRule({ name: "Demo scores", trigger: "SENTINEL_SCORE_CROSS" }, db)).isDemo).toBe(true);
      const row = observation(0);
      let acked = false;
      await dispatchPendingTradeAlerts(wallet, {
        getPendingTradeAlerts: async () => [{ wallet, signature: row.trades[0]!.signature, trade: row.trades[0]! }],
        ackTradeAlert: async () => { acked = true; },
      }, db);
      expect(acked).toBe(true);
      expect((await db.getState()).alertEvents).toMatchObject([{ ruleId: live.id, delivered: true, isDemo: false }]);
    } finally { vi.unstubAllEnvs(); }
  });
});

describe.skipIf(!local)("durable trade alert outbox", () => {
  const schema = `sat_alert_outbox_${randomUUID().replaceAll("-", "")}`;
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

  it("commits outbox with cursor, bounds capacity, then persists and acknowledges one inbox fact across restart", async () => {
    const store = new PostgresIngestionStore(scopedUrl, { maxOutbox: 1 });
    const db = new PostgresDatabase(scopedUrl);
    try {
      await db.addAlertRule(rule(randomUUID()));
      await store.commitPage(wallet, 0, [observation(0)], next);
      expect(await store.getPendingTradeAlerts(wallet)).toHaveLength(1);
      expect(await store.getCheckpoints()).toMatchObject([{ wallet, checkpoint: { version: 1, coverage: "CURRENT" } }]);
      await expect(store.commitPage(wallet, 1, [observation(1)], { ...next, anchor: signature(1) }))
        .rejects.toMatchObject({ code: "INGESTION_ALERT_OUTBOX_CAPACITY" });
      expect((await store.getCheckpoint(wallet)).version).toBe(1);
      expect((await store.getTrades(wallet))).toHaveLength(1);
      const first = await dispatchPendingTradeAlerts(wallet, store, db);
      expect(first).toMatchObject({ processed: 1, events: 1 });
      expect((await db.getState()).alertEvents).toHaveLength(1);
      expect((await db.getState()).alertEvents[0]?.delivered).toBe(true);
      expect(await store.getPendingTradeAlerts(wallet)).toHaveLength(0);
    } finally { await Promise.all([store.close(), db.close()]); }
    const store2 = new PostgresIngestionStore(scopedUrl, { maxOutbox: 1 });
    const db2 = new PostgresDatabase(scopedUrl);
    try {
      await store2.commitPage(wallet, 1, [observation(1)], { ...next, anchor: signature(1) });
      const pending = await store2.getPendingTradeAlerts(wallet);
      expect(pending).toHaveLength(1);
      const originalAck = store2.ackTradeAlert.bind(store2);
      let once = true;
      store2.ackTradeAlert = async (w, sig) => { if (once) { once = false; throw new Error("simulated-crash-before-ack"); } await originalAck(w, sig); };
      await expect(dispatchPendingTradeAlerts(wallet, store2, db2)).rejects.toThrow("simulated-crash-before-ack");
      const before = (await db2.getState()).alertEvents;
      expect(before).toHaveLength(2);
      store2.ackTradeAlert = originalAck;
      await dispatchPendingTradeAlerts(wallet, store2, db2);
      const after = (await db2.getState()).alertEvents;
      expect(after).toHaveLength(2);
      expect(after[0]).toEqual(before[0]);
      expect(after[0]?.delivered).toBe(false);
      expect(after[0]?.suppressedReason).toBe("cooldown");
      expect(await store2.getPendingTradeAlerts(wallet)).toHaveLength(0);
    } finally { await Promise.all([store2.close(), db2.close()]); }
  });

  it("never claims delivery for an unsupported external channel", async () => {
    const store = new PostgresIngestionStore(scopedUrl);
    const db = new PostgresDatabase(scopedUrl);
    try {
      await db.addAlertRule(rule(randomUUID(), "TELEGRAM"));
      const cp = await store.getCheckpoint(wallet);
      await store.commitPage(wallet, cp.version, [observation(2)], { ...next, anchor: signature(2) });
      await dispatchPendingTradeAlerts(wallet, store, db);
      const external = (await db.getState()).alertEvents.find((e) => e.channel === "TELEGRAM");
      expect(external).toMatchObject({ delivered: false, suppressedReason: "TELEGRAM provider not configured" });
    } finally { await Promise.all([store.close(), db.close()]); }
  });

  it("does not turn bootstrap history or future timestamps into new alerts", async () => {
    const store = new PostgresIngestionStore(scopedUrl);
    const db = new PostgresDatabase(scopedUrl);
    const historicalRuleId = randomUUID();
    try {
      await db.addAlertRule({ ...rule(historicalRuleId), createdAt: new Date().toISOString() });
      const cp = await store.getCheckpoint(wallet);
      await store.commitPage(wallet, cp.version, [observation(3)], { ...next, anchor: signature(3) });
      await dispatchPendingTradeAlerts(wallet, store, db);
      expect((await db.getState()).alertEvents.some((e) => e.ruleId === historicalRuleId)).toBe(false);
      const future = observation(4);
      future.trades[0] = { ...future.trades[0]!, timestamp: new Date(Date.now() + 60_000).toISOString() };
      const cp2 = await store.getCheckpoint(wallet);
      await store.commitPage(wallet, cp2.version, [future], { ...next, anchor: signature(4) });
      await dispatchPendingTradeAlerts(wallet, store, db);
      expect((await db.getState()).alertEvents.some((e) => e.payload.tradeSignature === "leg-4")).toBe(false);
      expect(await store.getPendingTradeAlerts(wallet)).toHaveLength(0);
    } finally { await Promise.all([store.close(), db.close()]); }
  });
});
