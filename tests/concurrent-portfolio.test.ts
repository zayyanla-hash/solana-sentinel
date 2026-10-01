import { describe, expect, it } from "vitest";
import { InMemoryDatabase, PostgresDatabase, StalePortfolioError, AlreadyExecutedError } from "@sat/database";
import type { FillUnitOfWork } from "@sat/database";
import type { PaperOrder, Position, TradeProposal } from "@sat/shared";
import { getDemoCandidates, nowIso } from "@sat/shared";
import { executePaperProposal, markToMarket, resetProvidersForTests } from "@sat/pipeline";

function proposal(id: string): TradeProposal {
  return { id, status: "PROPOSED" } as TradeProposal;
}

function position(id: string): Position {
  return { id, mint: id, qty: 1, markUsd: 10 } as Position;
}

function order(id: string): PaperOrder {
  return { id, status: "FILLED", filledUsd: 10 } as PaperOrder;
}

function work(
  p: TradeProposal,
  expectedPortfolio: FillUnitOfWork["snapshot"],
  expectedPositions: Position[],
): FillUnitOfWork {
  const positions = [...expectedPositions, position(p.id)];
  const snapshot = {
    ...expectedPortfolio,
    timestamp: new Date(Date.parse(expectedPortfolio.timestamp) + 1000).toISOString(),
    cashUsd: expectedPortfolio.cashUsd - 10,
    positionsValueUsd: expectedPortfolio.positionsValueUsd + 10,
  };
  return {
    proposalId: p.id,
    proposal: { ...p, status: "ACCEPTED_PAPER" },
    order: order(p.id),
    expectedPortfolio,
    expectedPositions,
    snapshot,
    positions,
    events: [],
    navUsd: snapshot.navUsd,
    consumeProposal: true,
  };
}

describe("paper portfolio state compare-and-swap", () => {
  it("production mark and fill cannot both commit from one starting snapshot", async () => {
    const prior = {
      operatingMode: process.env.OPERATING_MODE,
      jupiterKey: process.env.JUPITER_API_KEY,
      fail: process.env.PAPER_FAIL_PROBABILITY,
      partial: process.env.PAPER_PARTIAL_PROBABILITY,
    };
    process.env.OPERATING_MODE = "PAPER";
    delete process.env.JUPITER_API_KEY;
    process.env.PAPER_FAIL_PROBABILITY = "0";
    process.env.PAPER_PARTIAL_PROBABILITY = "0";
    resetProvidersForTests();
    try {
      class BarrierDatabase extends InMemoryDatabase {
        armed = false;
        arrivals = 0;
        private release!: () => void;
        private readonly barrier = new Promise<void>((resolve) => { this.release = resolve; });

        override async getState() {
          const snapshot = await super.getState();
          if (this.armed) {
            this.arrivals += 1;
            if (this.arrivals === 2) this.release();
            await this.barrier;
          }
          return snapshot;
        }
      }

      const db = new BarrierDatabase(100_000);
      const assets = getDemoCandidates().filter((a) => a.symbol === "JUP" || a.symbol === "JTO");
      await db.setCandidates(assets);
      const initial = await db.getState();
      const held: Position = {
        id: "88888888-8888-4888-8888-888888888888",
        mint: assets[0]!.mint,
        symbol: assets[0]!.symbol,
        qty: 100,
        avgEntryUsd: 1,
        markUsd: 1,
        unrealizedPnlUsd: 0,
        realizedPnlUsd: 0,
        openedAt: nowIso(),
        updatedAt: nowIso(),
      };
      await db.setPositions([held]);
      await db.setPortfolio({
        ...initial.portfolio,
        cashUsd: 99_000,
        positionsValueUsd: 100,
        navUsd: 99_100,
      });
      const asset = assets[1]!;
      const p = {
        id: "99999999-9999-4999-8999-999999999999",
        mint: asset.mint,
        symbol: asset.symbol,
        side: "BUY",
        sizeUsd: 1_000,
        score: { id: "score", gateScore: 80, compositeScore: 80, explanation: [], strategyConfigVersion: "test" },
        tokenRisk: { id: "risk", riskTier: "LOWER_RISK", details: { estimatedPriceImpactPct: 0.2 } },
        policy: { id: "policy", decision: "APPROVED" },
        risk: { decision: "APPROVE", approvedSizeUsd: 1_000, configVersion: "test", reasons: [] },
        signals: [],
        status: "PROPOSED",
        createdAt: nowIso(),
        isDemo: true,
        dataSources: ["demo"],
      } as TradeProposal;
      await db.addProposal(p);
      db.armed = true;

      const results = await Promise.allSettled([markToMarket(db), executePaperProposal(p.id, db)]);
      expect(db.arrivals).toBeGreaterThanOrEqual(2);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason)
        .toBeInstanceOf(StalePortfolioError);
      const state = await db.getState();
      expect(state.equityHistory).toHaveLength(2);
      expect(state.portfolio.navUsd).toBeCloseTo(state.portfolio.cashUsd + state.portfolio.positionsValueUsd, 6);
      if (state.orders.length === 0) {
        expect(state.positions).toHaveLength(1);
        expect(state.positions[0]!.markUsd).toBe(assets[0]!.priceUsd);
        expect(state.proposals[0]!.status).toBe("PROPOSED");
      } else {
        expect(state.orders).toHaveLength(1);
        expect(state.positions).toHaveLength(2);
        expect(state.proposals[0]!.status).toBe("ACCEPTED_PAPER");
      }
    } finally {
      if (prior.operatingMode === undefined) delete process.env.OPERATING_MODE;
      else process.env.OPERATING_MODE = prior.operatingMode;
      if (prior.jupiterKey === undefined) delete process.env.JUPITER_API_KEY;
      else process.env.JUPITER_API_KEY = prior.jupiterKey;
      if (prior.fail === undefined) delete process.env.PAPER_FAIL_PROBABILITY;
      else process.env.PAPER_FAIL_PROBABILITY = prior.fail;
      if (prior.partial === undefined) delete process.env.PAPER_PARTIAL_PROBABILITY;
      else process.env.PAPER_PARTIAL_PROBABILITY = prior.partial;
      resetProvidersForTests();
    }
  });

  it("the production paper entry rejects one stale distinct-proposal fill without losing accounting", async () => {
    const prior = {
      operatingMode: process.env.OPERATING_MODE,
      jupiterKey: process.env.JUPITER_API_KEY,
      fail: process.env.PAPER_FAIL_PROBABILITY,
      partial: process.env.PAPER_PARTIAL_PROBABILITY,
    };
    process.env.OPERATING_MODE = "PAPER";
    delete process.env.JUPITER_API_KEY;
    process.env.PAPER_FAIL_PROBABILITY = "0";
    process.env.PAPER_PARTIAL_PROBABILITY = "0";
    resetProvidersForTests();
    try {
      class BarrierDatabase extends InMemoryDatabase {
        armed = false;
        arrivals = 0;
        private release!: () => void;
        private readonly barrier = new Promise<void>((resolve) => { this.release = resolve; });

        override async getState() {
          const snapshot = await super.getState();
          if (this.armed) {
            this.arrivals += 1;
            if (this.arrivals === 2) this.release();
            await this.barrier;
          }
          return snapshot;
        }
      }

      const db = new BarrierDatabase(100_000);
      const assets = getDemoCandidates().filter((a) => a.symbol === "JUP" || a.symbol === "JTO");
      await db.setCandidates(assets);
      const makeProposal = (asset: (typeof assets)[number], id: string): TradeProposal => ({
        id,
        mint: asset.mint,
        symbol: asset.symbol,
        side: "BUY",
        sizeUsd: 1_000,
        score: { id, gateScore: 80, compositeScore: 80, explanation: [], strategyConfigVersion: "test" },
        tokenRisk: {
          id,
          riskTier: "LOWER_RISK",
          details: { estimatedPriceImpactPct: 0.2 },
        },
        policy: { id, decision: "APPROVED" },
        risk: { decision: "APPROVE", approvedSizeUsd: 1_000, configVersion: "test", reasons: [] },
        signals: [],
        status: "PROPOSED",
        createdAt: nowIso(),
        isDemo: true,
        dataSources: ["demo"],
      } as TradeProposal);
      const p1 = makeProposal(assets[0]!, "66666666-6666-4666-8666-666666666666");
      const p2 = makeProposal(assets[1]!, "77777777-7777-4777-8777-777777777777");
      await db.addProposal(p1);
      await db.addProposal(p2);
      db.armed = true;

      const results = await Promise.allSettled([
        executePaperProposal(p1.id, db),
        executePaperProposal(p2.id, db),
      ]);
      expect(db.arrivals).toBeGreaterThanOrEqual(2);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason)
        .toBeInstanceOf(StalePortfolioError);
      const state = await db.getState();
      expect(state.orders).toHaveLength(1);
      expect(state.positions).toHaveLength(1);
      expect(state.proposals.filter((p) => p.status === "PROPOSED")).toHaveLength(1);
      const filled = state.orders[0]!;
      const costs = filled.spreadCostUsd + filled.slippageCostUsd + filled.impactCostUsd + filled.networkCostUsd;
      expect(state.portfolio.cashUsd).toBeCloseTo(100_000 - filled.filledUsd - costs, 6);
      expect(state.portfolio.navUsd).toBeCloseTo(state.portfolio.cashUsd + state.portfolio.positionsValueUsd, 6);
    } finally {
      if (prior.operatingMode === undefined) delete process.env.OPERATING_MODE;
      else process.env.OPERATING_MODE = prior.operatingMode;
      if (prior.jupiterKey === undefined) delete process.env.JUPITER_API_KEY;
      else process.env.JUPITER_API_KEY = prior.jupiterKey;
      if (prior.fail === undefined) delete process.env.PAPER_FAIL_PROBABILITY;
      else process.env.PAPER_FAIL_PROBABILITY = prior.fail;
      if (prior.partial === undefined) delete process.env.PAPER_PARTIAL_PROBABILITY;
      else process.env.PAPER_PARTIAL_PROBABILITY = prior.partial;
      resetProvidersForTests();
    }
  });

  it("rejects any fill without an explicit expected state", async () => {
    const db = new InMemoryDatabase(100);
    const p = proposal("00000000-0000-4000-8000-000000000000");
    await db.addProposal(p);
    const initial = await db.getState();
    const legacy = work(p, initial.portfolio, initial.positions);
    delete legacy.expectedPortfolio;
    delete legacy.expectedPositions;
    await expect(db.consumeProposalAndRecordFill(legacy)).rejects.toBeInstanceOf(StalePortfolioError);
    expect((await db.getState()).orders).toHaveLength(0);

    await expect(db.consumeProposalAndRecordFill({
      ...legacy,
      snapshot: initial.portfolio,
      positions: initial.positions,
    })).rejects.toBeInstanceOf(StalePortfolioError);
    expect((await db.getState()).orders).toHaveLength(0);
  });

  it("rejects a changed position set even when the portfolio summary is unchanged", async () => {
    const db = new InMemoryDatabase(100);
    const p = proposal("44444444-4444-4444-8444-444444444444");
    await db.addProposal(p);
    const initial = await db.getState();
    await db.setPositions([position("55555555-5555-4555-8555-555555555555")]);
    await expect(db.consumeProposalAndRecordFill(work(p, initial.portfolio, initial.positions)))
      .rejects.toBeInstanceOf(StalePortfolioError);
    expect((await db.getState()).orders).toHaveLength(0);
  });

  it("rejects one concurrent distinct-proposal fill, then permits an explicit fresh retry", async () => {
    const db = new InMemoryDatabase(100);
    const p1 = proposal("11111111-1111-4111-8111-111111111111");
    const p2 = proposal("22222222-2222-4222-8222-222222222222");
    await db.addProposal(p1);
    await db.addProposal(p2);
    const initial = await db.getState();
    const results = await Promise.allSettled([
      db.consumeProposalAndRecordFill(work(p1, initial.portfolio, initial.positions)),
      db.consumeProposalAndRecordFill(work(p2, initial.portfolio, initial.positions)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason)
      .toBeInstanceOf(StalePortfolioError);

    const after = await db.getState();
    expect(after.orders).toHaveLength(1);
    expect(after.positions).toHaveLength(1);
    expect(after.portfolio.cashUsd).toBe(90);
    expect(after.proposals.filter((p) => p.status === "ACCEPTED_PAPER")).toHaveLength(1);
    const pending = after.proposals.find((p) => p.status === "PROPOSED")!;

    await db.consumeProposalAndRecordFill(work(pending, after.portfolio, after.positions));
    const final = await db.getState();
    expect(final.orders).toHaveLength(2);
    expect(final.positions).toHaveLength(2);
    expect(final.portfolio.cashUsd).toBe(80);
    expect(final.proposals.every((p) => p.status === "ACCEPTED_PAPER")).toBe(true);
    await expect(db.consumeProposalAndRecordFill(work(pending, final.portfolio, final.positions)))
      .rejects.toBeInstanceOf(AlreadyExecutedError);
  });

  it("Postgres locks portfolio, checks current positions, and rolls back a stale fill", async () => {
    const db = new PostgresDatabase("postgres://unused:unused@127.0.0.1:1/unused", 100);
    const initial = await new InMemoryDatabase(100).getState();
    const p = proposal("33333333-3333-4333-8333-333333333333");
    const calls: string[] = [];
    const client = {
      query: async (sql: string) => {
        calls.push(sql);
        if (sql.includes("returning id")) return { rowCount: 1, rows: [{ id: p.id }] };
        if (sql.includes("from sat_portfolio")) {
          return { rows: [{ payload: { ...initial.portfolio, cashUsd: 90 } }] };
        }
        if (sql.includes("from sat_positions")) return { rows: [] };
        return { rowCount: 1, rows: [] };
      },
      release: () => undefined,
    };
    const fakePool = { connect: async () => client, end: async () => undefined };
    Object.assign(db, { pool: fakePool, ready: Promise.resolve() });

    await expect(db.consumeProposalAndRecordFill(work(p, initial.portfolio, [])))
      .rejects.toBeInstanceOf(StalePortfolioError);
    expect(calls.some((s) => s.includes("from sat_portfolio") && s.includes("for update"))).toBe(true);
    expect(calls.some((s) => s.includes("from sat_positions"))).toBe(true);
    expect(calls).toContain("rollback");
    expect(calls).not.toContain("commit");
    expect(calls.some((s) => s.includes("insert into sat_orders"))).toBe(false);
    await db.close();
  });

  it("Postgres mark transaction commits all replacements or rolls back on stale state", async () => {
    const db = new PostgresDatabase("postgres://unused:unused@127.0.0.1:1/unused", 100);
    const initial = await new InMemoryDatabase(100).getState();
    const marked = { ...initial.portfolio, navUsd: 110, positionsValueUsd: 10 };
    const nextPosition = position("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const calls: string[] = [];
    let currentPortfolio = initial.portfolio;
    const client = {
      query: async (sql: string) => {
        calls.push(sql);
        if (sql.includes("from sat_portfolio")) return { rows: [{ payload: currentPortfolio }] };
        if (sql.includes("from sat_positions")) return { rows: [] };
        return { rowCount: 1, rows: [] };
      },
      release: () => undefined,
    };
    Object.assign(db, {
      pool: { connect: async () => client, end: async () => undefined },
      ready: Promise.resolve(),
    });
    const work = {
      expectedPortfolio: initial.portfolio,
      expectedPositions: [],
      snapshot: marked,
      positions: [nextPosition],
      navUsd: marked.navUsd,
    };

    await db.recordMarkToMarket(work);
    const lockAt = calls.findIndex((s) => s.includes("from sat_portfolio") && s.includes("for update"));
    const positionsAt = calls.findIndex((s) => s.includes("from sat_positions"));
    const updateAt = calls.findIndex((s) => s.includes("update sat_portfolio"));
    const equityAt = calls.findIndex((s) => s.includes("insert into sat_equity"));
    expect(lockAt).toBeGreaterThan(0);
    expect(positionsAt).toBeGreaterThan(lockAt);
    expect(updateAt).toBeGreaterThan(positionsAt);
    expect(equityAt).toBeGreaterThan(updateAt);
    expect(calls.at(-1)).toBe("commit");

    calls.length = 0;
    currentPortfolio = { ...initial.portfolio, cashUsd: 90 };
    await expect(db.recordMarkToMarket(work)).rejects.toBeInstanceOf(StalePortfolioError);
    expect(calls).toContain("rollback");
    expect(calls).not.toContain("commit");
    expect(calls.some((s) => s.includes("delete from sat_positions"))).toBe(false);
    expect(calls.some((s) => s.includes("insert into sat_equity"))).toBe(false);
    await db.close();
  });
});
