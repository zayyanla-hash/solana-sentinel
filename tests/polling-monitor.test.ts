import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresIngestionStore } from "@sat/database";
import type { ChainObservation, IngestionCheckpoint } from "@sat/database";
import type { SignatureRow } from "../packages/solana/src/rpc-reader";
import { PollingMonitor } from "../packages/pipeline/src/monitor";

const wallet = "11111111111111111111111111111111";
const other = "So11111111111111111111111111111111111111112";
const system = "11111111111111111111111111111111";
const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const signature = (n: number) => `${"1".repeat(63)}${alphabet[n]}`;
const initial: IngestionCheckpoint = {
  anchor: null, target: null, targetObservedAt: null, before: null, coverage: "BOOTSTRAP_WINDOW",
  lastSuccessAt: null, lastError: null, version: 0,
};

function raw(n: number): Record<string, unknown> {
  return {
    slot: 100 + n, blockTime: 1_700_000_000 + n,
    transaction: { signatures: [signature(n)], message: {
      accountKeys: [{ pubkey: wallet, signer: true }, { pubkey: other, signer: false }],
      instructions: [{ programId: system, accounts: [], data: "", parsed: {
        type: "transfer", info: { source: wallet, destination: other, lamports: 100_000_000 },
      } }],
    } },
    meta: { err: null, fee: 5000, preBalances: [1_000_000_000, 0],
      postBalances: [899_995_000, 100_000_000], preTokenBalances: [], postTokenBalances: [] },
  };
}

function row(n: number): SignatureRow {
  return { signature: signature(n), slot: 100 + n, blockTime: 1_700_000_000 + n,
    err: null, confirmationStatus: "finalized" };
}

class FiniteReader {
  ledger: number[];
  unavailable = new Set<number>();
  malformed = new Set<number>();
  calls: Array<{ before: string | null; limit: number }> = [];
  constructor(entries: number[]) { this.ledger = entries; }
  async verifyMainnet(): Promise<void> { /* synthetic finalized mainnet fixture */ }
  async signatures(_wallet: string, before: string | null, limit: number): Promise<SignatureRow[]> {
    this.calls.push({ before, limit });
    const index = before === null ? 0 : this.ledger.findIndex((n) => signature(n) === before) + 1;
    return this.ledger.slice(index, index + limit).map(row);
  }
  async transaction(sig: string): Promise<Record<string, unknown>> {
    const n = this.ledger.find((value) => signature(value) === sig);
    if (n === undefined || this.unavailable.has(n)) return null as unknown as Record<string, unknown>;
    if (this.malformed.has(n)) return { ...raw(n), transaction: { signatures: [signature(n + 1)] } };
    return raw(n);
  }
}

class FakeStore {
  checkpoint = structuredClone(initial);
  observations = new Map<string, ChainObservation>();
  async getCheckpoint(_wallet: string): Promise<IngestionCheckpoint> { return structuredClone(this.checkpoint); }
  async commitPage(_wallet: string, expectedVersion: number, rows: ChainObservation[],
    next: Omit<IngestionCheckpoint, "version">): Promise<{ checkpoint: IngestionCheckpoint; inserted: number; duplicates: number }> {
    if (this.checkpoint.version !== expectedVersion) throw new Error("INGESTION_CHECKPOINT_CONFLICT");
    const copy = new Map(this.observations);
    let inserted = 0, duplicates = 0;
    for (const observation of rows) {
      const prior = copy.get(observation.signature);
      if (prior) {
        if (JSON.stringify(prior) !== JSON.stringify(observation)) throw new Error("INGESTION_OBSERVATION_CONFLICT");
        duplicates += 1;
      } else { copy.set(observation.signature, structuredClone(observation)); inserted += 1; }
    }
    this.observations = copy;
    this.checkpoint = { ...structuredClone(next), version: expectedVersion + 1 };
    return { checkpoint: structuredClone(this.checkpoint), inserted, duplicates };
  }
}

const monitor = (reader: FiniteReader, store: FakeStore, pageSize = 2, maxPagesPerCycle = 1,
  time = "2026-09-30T12:00:00.000Z") =>
  new PollingMonitor(reader, store, { pageSize, maxPagesPerCycle, clock: () => new Date(time) });

describe("polling monitor cursor behavior", () => {
  it("marks the bounded bootstrap window, then resumes catch-up until the old anchor is found", async () => {
    const reader = new FiniteReader([5, 4, 3]);
    const store = new FakeStore();
    const first = await monitor(reader, store).pollWallet(wallet);
    expect(first.ok).toBe(true);
    expect(first.coverage).toBe("BOOTSTRAP_WINDOW");
    expect(store.checkpoint.anchor).toBe(signature(5));
    expect(store.observations.size).toBe(2);

    reader.ledger = [7, 6, 5, 4, 3];
    const second = await monitor(reader, store).pollWallet(wallet);
    expect(second.coverage).toBe("CATCHING_UP");
    expect(store.checkpoint).toMatchObject({ anchor: signature(5), target: signature(7), before: signature(6) });
    const third = await monitor(reader, store).pollWallet(wallet);
    expect(third.ok).toBe(true);
    expect(third.coverage).toBe("CURRENT");
    expect(store.checkpoint.anchor).toBe(signature(7));
    expect([...store.observations.keys()]).toEqual([signature(5), signature(4), signature(7), signature(6)]);
  });

  it("does not treat a previously empty wallet's first populated page as complete", async () => {
    const reader = new FiniteReader([]);
    const store = new FakeStore();
    await monitor(reader, store).pollWallet(wallet);
    expect(store.checkpoint.anchor).toBeNull();
    expect(store.checkpoint.lastSuccessAt).not.toBeNull();
    reader.ledger = [5, 4, 3, 2, 1];
    const states: IngestionCheckpoint["coverage"][] = [];
    for (let i = 0; i < 3; i += 1) states.push((await monitor(reader, store).pollWallet(wallet)).coverage);
    expect(states.slice(0, -1)).not.toContain("CURRENT");
    expect(states.at(-1)).toBe("CURRENT");
    expect(store.observations.size).toBe(5);
  });

  it("retains the original head observation time through slow catch-up and restart", async () => {
    const reader = new FiniteReader([3, 2, 1]);
    const store = new FakeStore();
    await monitor(reader, store, 2, 1, "2026-09-30T11:59:00.000Z").pollWallet(wallet);
    reader.ledger = [7, 6, 5, 4, 3, 2, 1];
    const started = await monitor(reader, store, 2, 1, "2026-09-30T12:00:00.000Z").pollWallet(wallet);
    expect(started.coverage).toBe("CATCHING_UP");
    expect(started.checkpoint?.targetObservedAt).toBe("2026-09-30T12:00:00.000Z");
    reader.ledger = [8, 7, 6, 5, 4, 3, 2, 1];
    await monitor(reader, store, 2, 1, "2026-09-30T12:10:00.000Z").pollWallet(wallet);
    const completed = await monitor(reader, store, 2, 1, "2026-09-30T12:20:00.000Z").pollWallet(wallet);
    expect(completed.coverage).toBe("CURRENT");
    expect(completed.checkpoint).toMatchObject({ anchor: signature(7), target: null,
      targetObservedAt: null, lastSuccessAt: "2026-09-30T12:00:00.000Z" });
    expect(completed.checkpoint?.lastSuccessAt).not.toBe("2026-09-30T12:20:00.000Z");
    const refreshed = await monitor(reader, store, 2, 1, "2026-09-30T12:21:00.000Z").pollWallet(wallet);
    expect(refreshed.checkpoint?.lastSuccessAt).toBe("2026-09-30T12:21:00.000Z");
  });

  it("refreshes an empty wallet's head observation time", async () => {
    const reader = new FiniteReader([]);
    const store = new FakeStore();
    await monitor(reader, store, 2, 1, "2026-09-30T12:00:00.000Z").pollWallet(wallet);
    const latest = await monitor(reader, store, 2, 1, "2026-09-30T12:10:00.000Z").pollWallet(wallet);
    expect(latest.checkpoint?.lastSuccessAt).toBe("2026-09-30T12:10:00.000Z");
  });

  it("fails closed when the old anchor disappears and the historical page ends", async () => {
    const reader = new FiniteReader([3, 2]);
    const store = new FakeStore();
    await monitor(reader, store).pollWallet(wallet);
    reader.ledger = [6, 5, 4];
    await monitor(reader, store).pollWallet(wallet);
    const before = structuredClone(store.checkpoint);
    const result = await monitor(reader, store).pollWallet(wallet);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("rpc-history-gap");
    expect(store.checkpoint.anchor).toBe(before.anchor);
    expect(store.checkpoint.coverage).not.toBe("CURRENT");
  });

  it("does not acknowledge a page containing a missing or misidentified transaction", async () => {
    const reader = new FiniteReader([2, 1]);
    const store = new FakeStore();
    reader.unavailable.add(1);
    const missing = await monitor(reader, store).pollWallet(wallet);
    expect(missing.ok).toBe(false);
    expect(store.observations.size).toBe(0);
    expect(store.checkpoint).toMatchObject({ anchor: null, target: null, before: null });
    reader.unavailable.clear(); reader.malformed.add(1);
    const malformed = await monitor(reader, store).pollWallet(wallet);
    expect(malformed.ok).toBe(false);
    expect(store.observations.size).toBe(0);
    expect(store.checkpoint).toMatchObject({ anchor: null, target: null, before: null });
  });
});

const candidate = process.env.SENTINEL_TEST_DATABASE_URL?.trim();
const url = candidate ? new URL(candidate) : null;
const localTestDatabase = !!url && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  && /test/i.test(decodeURIComponent(url.pathname));

describe.skipIf(!localTestDatabase)("polling monitor process boundaries", () => {
  const schema = `sat_monitor_${randomUUID().replaceAll("-", "")}`;
  const scoped = new URL(candidate ?? "postgres://unused:unused@127.0.0.1:1/sentinel_test");
  scoped.searchParams.set("options", `-c search_path=${schema}`);
  const scopedUrl = scoped.toString();
  const { Pool } = createRequire(new URL("../packages/database/package.json", import.meta.url))("pg");
  const children: ChildProcess[] = [];
  let created = false;
  const launch = (mode: string) => {
    const child = fork(resolve("tests/fixtures/monitor-process.ts"), [mode], {
      execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { ...process.env, SENTINEL_MONITOR_SCOPED_URL: scopedUrl },
    });
    children.push(child);
    return child;
  };
  const message = (child: ChildProcess): Promise<{ phase: string; result?: unknown }> => new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error("monitor-child-timeout")), 10_000);
    child.once("message", (value) => { clearTimeout(timer); done(value as { phase: string; result?: unknown }); });
    child.once("error", (err) => { clearTimeout(timer); fail(err); });
  });
  const exited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve() : new Promise<void>((done) => child.once("exit", () => done()));

  beforeAll(async () => {
    const pool = new Pool({ connectionString: candidate! });
    try { await pool.query(`create schema ${schema}`); created = true; } finally { await pool.end(); }
  });
  afterAll(async () => {
    await Promise.all(children.map(async (child) => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited(child);
    }));
    if (!created) return;
    const pool = new Pool({ connectionString: candidate! });
    try { await pool.query(`drop schema ${schema} cascade`); } finally { await pool.end(); }
  });

  it("SIGKILL before commit leaves no facts or cursor, while after commit retains both", async () => {
    const before = launch("before-commit");
    expect((await message(before)).phase).toBe("before-commit");
    before.kill("SIGKILL"); await exited(before);
    const store = new PostgresIngestionStore(scopedUrl);
    try {
      expect((await store.getCheckpoint(wallet)).version).toBe(0);
      expect((await store.getStats()).observations).toBe(0);
      expect((await store.getStats()).trades).toBe(0);
    } finally { await store.close(); }

    const after = launch("after-commit");
    expect((await message(after)).phase).toBe("after-commit");
    after.kill("SIGKILL"); await exited(after);
    const reopened = new PostgresIngestionStore(scopedUrl);
    try {
      expect((await reopened.getCheckpoint(wallet)).version).toBe(1);
      expect((await reopened.getStats()).observations).toBe(1);
      expect((await reopened.getStats()).trades).toBe(1);
    } finally { await reopened.close(); }
    const replay = launch("replay");
    expect((await message(replay)).phase).toBe("completed");
    await exited(replay);
    expect(replay.exitCode).toBe(0);
    const finalStore = new PostgresIngestionStore(scopedUrl);
    try {
      expect((await finalStore.getStats()).observations).toBe(1);
      expect((await finalStore.getStats()).trades).toBe(1);
    } finally { await finalStore.close(); }
  });

  it("persists the pending head time across a real database reopen", async () => {
    const reader = new FiniteReader([5, 4, 3, 0]);
    const first = new PostgresIngestionStore(scopedUrl);
    let pending: IngestionCheckpoint;
    try {
      const result = await new PollingMonitor(reader, first, { pageSize: 2, maxPagesPerCycle: 1,
        clock: () => new Date("2026-09-30T12:00:00.000Z") }).pollWallet(wallet);
      expect(result.coverage).toBe("CATCHING_UP");
      pending = (await first.getCheckpoint(wallet));
      expect(pending.targetObservedAt).toBe("2026-09-30T12:00:00.000Z");
    } finally { await first.close(); }
    reader.ledger = [6, 5, 4, 3, 0];
    const reopened = new PostgresIngestionStore(scopedUrl);
    try {
      const resumed = await new PollingMonitor(reader, reopened, { pageSize: 2, maxPagesPerCycle: 1,
        clock: () => new Date("2026-09-30T12:20:00.000Z") }).pollWallet(wallet);
      expect(resumed.coverage).toBe("CURRENT");
      expect(resumed.checkpoint).toMatchObject({ anchor: signature(5), target: null,
        targetObservedAt: null, lastSuccessAt: "2026-09-30T12:00:00.000Z" });
    } finally { await reopened.close(); }
  });
});
