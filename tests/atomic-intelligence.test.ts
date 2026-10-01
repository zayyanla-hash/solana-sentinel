import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { InMemoryDatabase, PostgresDatabase, StalePortfolioError } from "@sat/database";
import type { FillUnitOfWork } from "@sat/database";
import type { AlertEvent, AlertRule, BacktestResult, WalletCredibilityScore, WatchlistItem, TradeProposal } from "@sat/shared";

const address = "11111111111111111111111111111111";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (n: number): WatchlistItem => ({
  id: id(n), kind: "MINT", address: n % 2 ? address : "So11111111111111111111111111111111111111112",
  addedAt: new Date().toISOString(),
});
const rule = (n: number): AlertRule => ({ id: id(n), name: `rule-${n}` } as AlertRule);
const backtest = (n: number): BacktestResult => ({ id: id(n), strategyVersion: `v${n}` } as BacktestResult);
const event = (n: number): AlertEvent => ({ id: id(n), ruleId: id(1), payload: { mint: address } } as AlertEvent);
const score = (n: number): WalletCredibilityScore => ({ address: n % 2 ? address : "So11111111111111111111111111111111111111112", score: n } as WalletCredibilityScore);

async function checkAtomicMutations(db: InMemoryDatabase | PostgresDatabase) {
  const first = item(1);
  const second = item(2);
  const [a, b] = await Promise.all([db.addWatchlistItem(first, 2), db.addWatchlistItem(first, 2)]);
  expect(a.id).toBe(b.id);
  await db.addWatchlistItem(second, 2);
  expect(await db.addWatchlistItem(item(3), 2)).toEqual(a); // Duplicate precedes the cap.
  await expect(db.addWatchlistItem({ ...item(4), kind: "WALLET" }, 2)).rejects.toThrow("WATCHLIST_LIMIT");
  await Promise.all([db.upsertWalletScore(score(1)), db.upsertWalletScore(score(2))]);
  await Promise.all([db.addAlertRule(rule(1)), db.addAlertRule(rule(2))]);
  await Promise.all([db.addBacktest(backtest(1)), db.addBacktest(backtest(2))]);
  await Promise.all([db.addAlertEvents([event(1)]), db.addAlertEvents([event(2), event(2)])]);
  const state = await db.getState();
  expect(state.watchlist).toHaveLength(2);
  expect(state.walletScores).toHaveLength(2);
  expect(state.alertRules).toHaveLength(2);
  expect(state.backtests).toHaveLength(2);
  expect(state.alertEvents).toHaveLength(2);
  await db.addBacktest(backtest(1));
  await db.addAlertEvents([event(1)]);
  const deduped = await db.getState();
  expect(deduped.backtests).toHaveLength(2);
  expect(deduped.alertEvents).toHaveLength(2);
  await db.removeWatchlistItem(first.id);
  expect((await db.getState()).watchlist.map((w) => w.id)).toEqual([second.id]);
}

describe("atomic intelligence mutations", () => {
  it("preserves independent collections and returns defensive snapshots in memory", async () => {
    const db = new InMemoryDatabase();
    await checkAtomicMutations(db);
    const state = await db.getState();
    state.alertRules.splice(0);
    expect((await db.getState()).alertRules).toHaveLength(2);
  });

  it("enforces the cap when different items arrive together in memory", async () => {
    const db = new InMemoryDatabase();
    const result = await Promise.allSettled([
      db.addWatchlistItem(item(1), 1), db.addWatchlistItem(item(2), 1),
    ]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(result.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect((await db.getState()).watchlist).toHaveLength(1);
  });
});

// Opt in only to a disposable local test database. Never fall back to DATABASE_URL.
const candidate = process.env.SENTINEL_TEST_DATABASE_URL?.trim();
const url = candidate ? new URL(candidate) : null;
const localTestDatabase = !!url && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  && /test/i.test(decodeURIComponent(url.pathname));

describe.skipIf(!localTestDatabase)("Postgres atomic intelligence mutations", () => {
  const schema = `sat_atomic_${randomUUID().replaceAll("-", "")}`;
  const testUrl = new URL(candidate ?? "postgres://unused:unused@127.0.0.1:1/sentinel_test");
  testUrl.searchParams.set("options", `-c search_path=${schema}`);
  const scopedUrl = testUrl.toString();
  const { Pool } = createRequire(new URL("../packages/database/package.json", import.meta.url))("pg");

  beforeAll(async () => {
    const pool = new Pool({ connectionString: candidate! });
    try { await pool.query(`create schema ${schema}`); } finally { await pool.end(); }
  });

  afterAll(async () => {
    const pool = new Pool({ connectionString: candidate! });
    try { await pool.query(`drop schema ${schema} cascade`); } finally { await pool.end(); }
  });

  it("serializes two instances across fields and collections, then survives reopen", async () => {
    const a = new PostgresDatabase(scopedUrl, 25_000);
    const b = new PostgresDatabase(scopedUrl, 25_000);
    try {
      await Promise.all([a.getState(), b.getState()]);
      await Promise.all([
        a.setSentinelSignals([]),
        b.addWatchlistItem(item(1), 2),
        a.addAlertRule(rule(1)),
        b.addAlertRule(rule(2)),
        a.addBacktest(backtest(1)),
        b.addBacktest(backtest(2)),
      ]);
      await checkAtomicMutations(a);
      const state = await b.getState();
      expect(state.watchlist).toHaveLength(1);
      expect(state.alertRules).toHaveLength(2);
      expect(state.backtests).toHaveLength(2);
      expect(state.alertEvents).toHaveLength(2);
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
    const reopened = new PostgresDatabase(scopedUrl, 25_000);
    try {
      const state = await reopened.getState();
      expect(state.alertRules).toHaveLength(2);
      expect(state.alertEvents).toHaveLength(2);
    } finally {
      await reopened.close();
    }
  });

  it("enforces the cap across two instances on simultaneous distinct inserts", async () => {
    const a = new PostgresDatabase(scopedUrl, 25_000);
    const b = new PostgresDatabase(scopedUrl, 25_000);
    try {
      await a.reset(25_000);
      const result = await Promise.allSettled([
        a.addWatchlistItem(item(1), 1), b.addWatchlistItem(item(2), 1),
      ]);
      expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(result.filter((r) => r.status === "rejected")).toHaveLength(1);
      expect((await b.getState()).watchlist).toHaveLength(1);
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  });

  it("rolls back a consumed proposal when the portfolio snapshot is stale", async () => {
    const db = new PostgresDatabase(scopedUrl, 25_000);
    const pool = new Pool({ connectionString: scopedUrl });
    try {
      await db.reset(25_000);
      const before = await db.getState();
      const proposal = {
        id: id(77), mint: address, status: "PROPOSED", createdAt: new Date().toISOString(),
      } as TradeProposal;
      await db.addProposal(proposal);
      const work = {
        proposalId: proposal.id,
        proposal: { ...proposal, status: "ACCEPTED_PAPER" },
        order: { id: id(78), mint: address, createdAt: new Date().toISOString() },
        expectedPortfolio: { ...before.portfolio, cashUsd: before.portfolio.cashUsd + 1 },
        expectedPositions: before.positions,
        snapshot: before.portfolio,
        positions: before.positions,
        events: [],
        navUsd: before.portfolio.navUsd,
        consumeProposal: true,
      } as FillUnitOfWork;
      await expect(db.consumeProposalAndRecordFill(work)).rejects.toBeInstanceOf(StalePortfolioError);
      const row = await pool.query("select payload->>'status' as status from sat_proposals where id = $1", [proposal.id]);
      expect(row.rows[0]?.status).toBe("PROPOSED");
      expect((await pool.query("select count(*)::int as n from sat_orders")).rows[0]?.n).toBe(0);
      expect((await db.getState()).equityHistory).toHaveLength(before.equityHistory.length);
    } finally {
      await Promise.all([db.close(), pool.end()]);
    }
  });

  it("refuses a future schema version without downgrading it and retries after repair", async () => {
    const pool = new Pool({ connectionString: scopedUrl });
    const db = new PostgresDatabase(scopedUrl, 25_000);
    try {
      await pool.query("update sat_schema_version set version = 999 where id = 1");
      await expect(db.getState()).rejects.toThrow("sat-schema-newer-than-runtime");
      expect((await pool.query("select version from sat_schema_version where id = 1")).rows[0]?.version).toBe(999);
      await pool.query("update sat_schema_version set version = 3 where id = 1");
      expect((await db.getState()).mode).toBe("postgres");
    } finally {
      await pool.query("update sat_schema_version set version = 3 where id = 1").catch(() => undefined);
      await Promise.all([db.close(), pool.end()]);
    }
  });
});
