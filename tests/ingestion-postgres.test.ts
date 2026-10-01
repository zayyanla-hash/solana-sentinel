import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresIngestionStore, IngestionStoreError } from "@sat/database";
import type { ChainObservation, IngestionCheckpoint } from "@sat/database";
import type { WalletTrade } from "@sat/shared";

const wallet = "11111111111111111111111111111111";
const otherWallet = "So11111111111111111111111111111111111111112";
const signature = (n: number) => `${"1".repeat(63)}${"23456789ABCDEFGHJKLMNPQRSTUVWXYZ"[n]}`;
const checkpoint = (anchor: string): Omit<IngestionCheckpoint, "version"> => ({
  anchor, target: anchor, before: null, coverage: "CURRENT", lastSuccessAt: new Date().toISOString(), lastError: null,
});
const trade = (n: number, sourceSignature = signature(n)): WalletTrade => ({
  signature: `trade-${n}`, sourceSignature, timestamp: new Date(1_700_000_000_000 + n * 1000).toISOString(),
  mint: wallet, side: "BUY", usdNotional: 0, qty: n + 1, priceUsd: null,
  tokenAgeHoursAtEntry: null, liquidityUsdAtEntry: null, slippageBps: null, isDemo: false,
});
const observation = (n: number, trades: WalletTrade[] = [trade(n)]): ChainObservation => ({
  wallet, signature: signature(n), slot: 100 + n, blockTime: 1_700_000_000 + n,
  outcome: "CLASSIFIED", reason: "test-classified", raw: { slot: 100 + n, data: { n } }, trades,
});

// Never use DATABASE_URL or a nonlocal database. Each run owns only its random schema.
const candidate = process.env.SENTINEL_TEST_DATABASE_URL?.trim();
const parsed = candidate ? new URL(candidate) : null;
const localTestDatabase = !!parsed && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
  && /test/i.test(decodeURIComponent(parsed.pathname));

describe.skipIf(!localTestDatabase)("Postgres durable ingestion", () => {
  const schema = `sat_ingestion_${randomUUID().replaceAll("-", "")}`;
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

  it("bootstraps concurrently and enforces the wallet cap", async () => {
    const a = new PostgresIngestionStore(scopedUrl, { maxWallets: 1, maxObservations: 2 });
    const b = new PostgresIngestionStore(scopedUrl, { maxWallets: 1, maxObservations: 2 });
    try {
      const [one, two] = await Promise.all([a.getCheckpoint(wallet), b.getCheckpoint(wallet)]);
      expect(one).toEqual(two);
      expect(one).toMatchObject({ anchor: null, target: null, before: null, coverage: "BOOTSTRAP_WINDOW", version: 0 });
      await expect(b.getCheckpoint(otherWallet)).rejects.toMatchObject({ code: "INGESTION_WALLET_CAPACITY" });
      expect((await a.getStats()).wallets).toBe(1);
    } finally { await Promise.all([a.close(), b.close()]); }
  });

  it("commits facts and cursor atomically, rejects changed replay, conflicts, and capacity", async () => {
    const a = new PostgresIngestionStore(scopedUrl, { maxWallets: 1, maxObservations: 2 });
    const b = new PostgresIngestionStore(scopedUrl, { maxWallets: 1, maxObservations: 2 });
    try {
      const first = await a.commitPage(wallet, 0, [observation(0)], checkpoint(signature(0)));
      expect(first).toMatchObject({ inserted: 1, duplicates: 0, checkpoint: { version: 1 } });
      const replay = await b.commitPage(wallet, 1, [observation(0)], checkpoint(signature(0)));
      expect(replay).toMatchObject({ inserted: 0, duplicates: 1, checkpoint: { version: 2 } });
      await expect(a.commitPage(wallet, 2, [{ ...observation(0), raw: { changed: true } }], checkpoint(signature(0))))
        .rejects.toMatchObject({ code: "INGESTION_OBSERVATION_CONFLICT" });
      expect((await b.getCheckpoint(wallet)).version).toBe(2);

      const competing = await Promise.allSettled([
        a.commitPage(wallet, 2, [observation(1)], checkpoint(signature(1))),
        b.commitPage(wallet, 2, [observation(2)], checkpoint(signature(2))),
      ]);
      expect(competing.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(competing.filter((r) => r.status === "rejected")).toHaveLength(1);
      const winner = competing.find((r) => r.status === "fulfilled")!.value;
      expect(winner.checkpoint.version).toBe(3);
      const full = await b.getStats();
      expect(full).toMatchObject({ wallets: 1, observations: 2, trades: 2, outcomes: { CLASSIFIED: 2 }, coverage: { CURRENT: 1 } });
      const missing = winner.checkpoint.anchor === signature(1) ? observation(2) : observation(1);
      await expect(b.commitPage(wallet, 3, [missing], checkpoint(missing.signature)))
        .rejects.toMatchObject({ code: "INGESTION_OBSERVATION_CAPACITY" });
      expect((await a.getCheckpoint(wallet)).version).toBe(3);
      expect(await a.getTrades(wallet)).toHaveLength(2);
    } finally { await Promise.all([a.close(), b.close()]); }
    const reopened = new PostgresIngestionStore(scopedUrl, { maxWallets: 1, maxObservations: 2 });
    try {
      expect((await reopened.getCheckpoint(wallet)).version).toBe(3);
      expect((await reopened.getTrades(wallet))).toHaveLength(2);
    } finally { await reopened.close(); }
  });

  it("rejects conflicting trade effects and rolls back all observations on checkpoint failure", async () => {
    const db = new PostgresIngestionStore(scopedUrl, { maxObservations: 10 });
    const pool = new Pool({ connectionString: scopedUrl });
    try {
      const current = await db.getCheckpoint(wallet);
      const existing = (await db.getTrades(wallet))[0]!;
      const conflicting = { ...existing, sourceSignature: signature(3), qty: existing.qty + 10 };
      await expect(db.commitPage(wallet, current.version, [observation(3, [conflicting])], checkpoint(signature(3))))
        .rejects.toMatchObject({ code: "INGESTION_TRADE_CONFLICT" });
      expect((await db.getStats()).observations).toBe(2);
      expect((await db.getCheckpoint(wallet)).version).toBe(current.version);

      await pool.query(`create function ${schema}.reject_checkpoint() returns trigger language plpgsql as $$
        begin raise exception 'injected checkpoint failure'; end; $$`);
      await pool.query(`create trigger reject_checkpoint before update on sat_ingestion_wallets
        for each row execute function ${schema}.reject_checkpoint()`);
      await expect(db.commitPage(wallet, current.version, [observation(4)], checkpoint(signature(4))))
        .rejects.toThrow("injected checkpoint failure");
      expect((await db.getStats()).observations).toBe(2);
      expect((await db.getStats()).trades).toBe(2);
      expect((await db.getCheckpoint(wallet)).version).toBe(current.version);
    } finally {
      await pool.query("drop trigger if exists reject_checkpoint on sat_ingestion_wallets").catch(() => undefined);
      await Promise.all([db.close(), pool.end()]);
    }
  });

  it("fails invalid rows before opening a transaction", async () => {
    const db = new PostgresIngestionStore(scopedUrl);
    try {
      await expect(db.commitPage(wallet, 0, [
        { ...observation(0), slot: -1 },
      ], checkpoint(signature(0)))).rejects.toBeInstanceOf(IngestionStoreError);
    } finally { await db.close(); }
  });
});
