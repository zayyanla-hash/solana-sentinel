import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getDemoCandidates, newId, nowIso, DEFAULT_RISK_CONFIG } from "@sat/shared";
import {
  resetDatabaseForTests,
  STORE_SCHEMA_SQL,
  AlreadyExecutedError,
  InMemoryDatabase,
} from "@sat/database";
import {
  executePaperProposal,
  evaluateMint,
  lastTradeAtByMint,
  markToMarket,
  resetProvidersForTests,
} from "@sat/pipeline";
import { bindRequiresAuth, ActionSchema, mutatingRequestDenied } from "../apps/web/src/lib/request-guard";
import type { Position, PaperOrder } from "@sat/shared";
import { assessTokenRisk } from "@sat/token-risk";
import { PolicyEngine } from "@sat/policy-engine";
import { RiskEngine } from "@sat/risk-engine";
import { DEFAULT_POLICY_CONFIG } from "@sat/shared";

const jup = getDemoCandidates().find((c) => c.symbol === "JUP")!;
const jto = getDemoCandidates().find((c) => c.symbol === "JTO")!;

function extraMints(): string[] {
  return [
    jto.mint,
    getDemoCandidates().find((c) => c.symbol === "RAY")!.mint,
    getDemoCandidates().find((c) => c.symbol === "PYTH")!.mint,
    getDemoCandidates().find((c) => c.symbol === "BONK")!.mint,
    getDemoCandidates().find((c) => c.symbol === "WIF")!.mint,
    getDemoCandidates().find((c) => c.symbol === "SOL")!.mint,
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  ];
}

function proposalFrom(asset = jup) {
  const tokenRisk = assessTokenRisk(asset, {
    tokenProgram: "TOKEN",
    mintAuthority: false,
    freezeAuthority: false,
    permanentDelegate: false,
    transferRestrictions: false,
    topHolderConcentrationPct: 25,
    exitLiquidityUsd: 5_000_000,
    estimatedPriceImpactPct: 0.2,
    metadataQuality: 0.9,
  });
  const { assessment: policy } = new PolicyEngine(DEFAULT_POLICY_CONFIG).evaluate(asset);
  const { result: risk } = new RiskEngine(DEFAULT_RISK_CONFIG).evaluate(asset, {
    portfolio: {
      timestamp: nowIso(),
      navUsd: 100_000,
      cashUsd: 100_000,
      positionsValueUsd: 0,
      drawdownPct: 0,
      peakNavUsd: 100_000,
    },
    positions: [],
    requestedSizeUsd: 1000,
    score: {
      mint: asset.mint,
      compositeScore: 80,
      gateScore: 80,
      components: {},
      weights: {},
      strategyConfigVersion: "strategy-v1.1",
      explanation: ["test"],
      scoredAt: nowIso(),
    },
    estimatedPriceImpactPct: 0.2,
    slippageBps: 50,
  });
  return {
    id: newId(),
    mint: asset.mint,
    symbol: asset.symbol,
    side: "BUY" as const,
    sizeUsd: 1000,
    score: {
      mint: asset.mint,
      compositeScore: 80,
      gateScore: 80,
      components: {},
      weights: {},
      strategyConfigVersion: "strategy-v1.1",
      explanation: ["test"],
      scoredAt: nowIso(),
    },
    tokenRisk,
    policy,
    risk,
    signals: [],
    status: "PROPOSED" as const,
    createdAt: nowIso(),
    isDemo: true,
    dataSources: ["demo"],
  };
}

describe("schema single-source", () => {
  it("migration file contains STORE_SCHEMA_SQL", () => {
    const mig = readFileSync(
      join(process.cwd(), "supabase/migrations/20260908000000_v15_store.sql"),
      "utf8",
    );
    const compact = (s: string) => s.replace(/\s+/g, " ").trim();
    expect(compact(mig)).toContain(compact(STORE_SCHEMA_SQL).slice(0, 200));
    expect(mig).toContain("sat_schema_version");
    expect(mig).toContain("sat_orders_proposal_id_uidx");
  });
});

describe("red-team architectural fixes", () => {
  beforeEach(() => {
    resetDatabaseForTests(100_000);
    resetProvidersForTests();
    process.env.PAPER_FAIL_PROBABILITY = "0";
    process.env.PAPER_PARTIAL_PROBABILITY = "0";
  });

  it("expired proposal cannot execute", async () => {
    const db = resetDatabaseForTests(100_000);
    await db.setCandidates([jup]);
    const p = { ...proposalFrom(), createdAt: new Date(Date.now() - 20 * 60_000).toISOString() };
    await db.addProposal(p);
    await expect(executePaperProposal(p.id, db)).rejects.toThrow(/expired/i);
  });

  it("execute-time max_positions re-evaluation rejects the 9th fill", async () => {
    const db = resetDatabaseForTests(100_000);
    await db.setCandidates([jup]);
    const positions: Position[] = extraMints().map((mint, i) => ({
      id: newId(),
      mint,
      symbol: `T${i}`,
      qty: 1,
      avgEntryUsd: 1,
      markUsd: 1,
      unrealizedPnlUsd: 0,
      realizedPnlUsd: 0,
      openedAt: nowIso(),
      updatedAt: nowIso(),
    }));
    expect(positions).toHaveLength(8);
    await db.setPositions(positions);
    const p = proposalFrom();
    await db.addProposal(p);
    await expect(executePaperProposal(p.id, db)).rejects.toThrow(/re-evaluated at execute|Risk REJECT/i);
  });

  it("concurrent execute yields a single fill", async () => {
    const db = resetDatabaseForTests(100_000);
    await db.setCandidates([jup]);
    const p = proposalFrom();
    await db.addProposal(p);
    const results = await Promise.allSettled([
      executePaperProposal(p.id, db),
      executePaperProposal(p.id, db),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    const state = await db.getState();
    expect(state.orders.filter((o) => o.status === "FILLED" || o.status === "PARTIAL")).toHaveLength(1);
    expect(state.proposals[0]?.status).toBe("ACCEPTED_PAPER");
    expect(bad[0]?.status === "rejected" && (bad[0].reason as Error).name === "AlreadyExecutedError" ||
      String((bad[0] as PromiseRejectedResult).reason).match(/already paper-executed/i)).toBeTruthy();
    void AlreadyExecutedError;
  });

  it("lastTradeAtByMint uses the newest fill", () => {
    const orders: PaperOrder[] = [
      {
        id: newId(),
        mint: jup.mint,
        side: "BUY",
        requestedUsd: 1,
        filledUsd: 1,
        filledQty: 1,
        avgPriceUsd: 1,
        status: "FILLED",
        spreadCostUsd: 0,
        slippageCostUsd: 0,
        impactCostUsd: 0,
        networkCostUsd: 0,
        latencyMs: 1,
        provenance: {
          strategyConfigVersion: "x",
          riskConfigVersion: "x",
          dataSources: [],
          reasons: [],
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        isDemo: true,
      },
      {
        id: newId(),
        mint: jup.mint,
        side: "BUY",
        requestedUsd: 1,
        filledUsd: 1,
        filledQty: 1,
        avgPriceUsd: 1,
        status: "FILLED",
        spreadCostUsd: 0,
        slippageCostUsd: 0,
        impactCostUsd: 0,
        networkCostUsd: 0,
        latencyMs: 1,
        provenance: {
          strategyConfigVersion: "x",
          riskConfigVersion: "x",
          dataSources: [],
          reasons: [],
        },
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        isDemo: true,
      },
    ];
    expect(lastTradeAtByMint(orders)[jup.mint]).toBe("2026-01-02T00:00:00.000Z");
  });

  it("markToMarket updates NAV from candidate prices", async () => {
    const db = resetDatabaseForTests(100_000);
    const priced = { ...jup, priceUsd: 10 };
    await db.setCandidates([priced]);
    await db.setPositions([
      {
        id: newId(),
        mint: jup.mint,
        symbol: "JUP",
        qty: 100,
        avgEntryUsd: 1,
        markUsd: 1,
        unrealizedPnlUsd: 0,
        realizedPnlUsd: 0,
        openedAt: nowIso(),
        updatedAt: nowIso(),
      },
    ]);
    const snap = await db.getState();
    await db.setPortfolio({ ...snap.portfolio, cashUsd: 0, navUsd: 100, positionsValueUsd: 100 });
    const next = await markToMarket(db);
    expect(next.positionsValueUsd).toBe(1000);
    expect(next.navUsd).toBe(1000);
  });

  it("evaluateMint stamps isDemo provenance", async () => {
    const mem = resetDatabaseForTests(100_000);
    await mem.setCandidates(getDemoCandidates());
    const p = await evaluateMint(jup.mint, mem);
    expect(p?.isDemo).toBe(true);
    expect(p?.dataSources?.length).toBeGreaterThan(0);
    expect(p?.provenance?.tokenRiskId || p?.tokenRisk.id).toBeTruthy();
  });

  it("INVALID_ACTION for live set_mode", () => {
    expect(ActionSchema.safeParse({ action: "set_mode", mode: "LIVE" }).success).toBe(false);
  });

  it("non-loopback bind without token is denied", () => {
    const prev = process.env.SAT_BIND_HOST;
    process.env.SAT_BIND_HOST = "0.0.0.0";
    delete process.env.SAT_API_TOKEN;
    try {
      expect(bindRequiresAuth()).toBe(true);
      const denied = mutatingRequestDenied(
        new Request("http://example.com/api/state", {
          method: "POST",
          headers: { host: "localhost:4317", origin: "http://localhost:4317" },
        }),
      );
      expect(denied?.code).toBe("AUTH_REQUIRED");
    } finally {
      if (prev === undefined) delete process.env.SAT_BIND_HOST;
      else process.env.SAT_BIND_HOST = prev;
    }
  });
});

describe("memory mutex consume", () => {
  it("second consume throws AlreadyExecutedError", async () => {
    const db = new InMemoryDatabase(50_000);
    const p = proposalFrom();
    await db.addProposal(p);
    const order: PaperOrder = {
      id: newId(),
      mint: p.mint,
      side: "BUY",
      requestedUsd: 10,
      filledUsd: 10,
      filledQty: 1,
      avgPriceUsd: 10,
      status: "FILLED",
      spreadCostUsd: 0,
      slippageCostUsd: 0,
      impactCostUsd: 0,
      networkCostUsd: 0,
      latencyMs: 1,
      provenance: {
        strategyConfigVersion: "x",
        riskConfigVersion: "x",
        dataSources: [],
        reasons: [],
      },
      createdAt: nowIso(),
      updatedAt: nowIso(),
      isDemo: true,
    };
    const snap = await db.getState();
    await db.consumeProposalAndRecordFill({
      proposalId: p.id,
      proposal: { ...p, status: "ACCEPTED_PAPER" },
      order,
      expectedPortfolio: snap.portfolio,
      expectedPositions: snap.positions,
      snapshot: snap.portfolio,
      positions: [],
      events: [],
      navUsd: snap.portfolio.navUsd,
      consumeProposal: true,
    });
    await expect(
      db.consumeProposalAndRecordFill({
        proposalId: p.id,
        proposal: { ...p, status: "ACCEPTED_PAPER" },
        order: { ...order, id: newId() },
        expectedPortfolio: snap.portfolio,
      expectedPositions: snap.positions,
      snapshot: snap.portfolio,
        positions: [],
        events: [],
        navUsd: snap.portfolio.navUsd,
        consumeProposal: true,
      }),
    ).rejects.toBeInstanceOf(AlreadyExecutedError);
  });
});
