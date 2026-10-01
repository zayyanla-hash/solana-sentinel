import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getDemoCandidates, nowIso } from "@sat/shared";
import { InMemoryDatabase, PostgresDatabase } from "@sat/database";
import { originAllowed } from "../apps/web/src/lib/request-guard";
import {
  HeliusOnChainProvider,
  parseMintExtensions,
  concentrationFromLargestAccounts,
} from "@sat/solana";

describe("request origin guard", () => {
  it("allows loopback origin and loopback host without origin", () => {
    expect(originAllowed("http://127.0.0.1:4317", "127.0.0.1:4317")).toBe(true);
    expect(originAllowed(null, "127.0.0.1:4317")).toBe(true);
    expect(originAllowed("http://evil.example", "example.com")).toBe(false);
    expect(originAllowed(null, "example.com")).toBe(false);
  });
});

describe("DAS mint_extensions mapping", () => {
  it("reads permanent_delegate and transfer_hook from mint_extensions", () => {
    const parsed = parseMintExtensions({
      permanent_delegate: { delegate: "TdMA45ZnakQCBt5XUvm7ib2htKuTWdcgGKu1eUGrDyJ" },
      transfer_hook: { program_id: "Hook1111111111111111111111111111111111111" },
    });
    expect(parsed.permanentDelegate).toBe(true);
    expect(parsed.transferHook).toBe(true);
    expect(parsed.transferRestrictions).toBe(true);
    expect(parsed.extensions).toContain("permanent_delegate");
  });

  it("Token-2022 missing mint_extensions stays UNKNOWN/null not false", () => {
    const parsed = parseMintExtensions(undefined);
    expect(parsed.permanentDelegate).toBeNull();
    expect(parsed.transferHook).toBeNull();
  });

  it("computes top-5/10 concentration from largest accounts + supply", () => {
    const conc = concentrationFromLargestAccounts(
      [
        { amount: "500" },
        { amount: "300" },
        { amount: "100" },
        { amount: "50" },
        { amount: "50" },
        { amount: "10" },
      ],
      "1000",
    );
    expect(conc.top5).toBeCloseTo(100, 5);
    expect(conc.top10).toBeCloseTo(100, 5);
  });

  it("helius still uses token_info authorities, not authorities[].type", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      if (body.includes("getAsset")) {
        return new Response(JSON.stringify({
            result: {
              token_info: {
                token_program: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
                mint_authority: "TdMA45ZnakQCBt5XUvm7ib2htKuTWdcgGKu1eUGrDyJ",
                freeze_authority: null,
                supply: 1000,
              },
              mint_extensions: {
                permanent_delegate: { delegate: "11111111111111111111111111111111" },
              },
              authorities: [{ type: "mint", address: "should-not-drive-mapping" }],
              content: { metadata: { name: "Ext", symbol: "EXT" } },
            },
          }), { headers: { "content-type": "application/json" } });
      }
      if (body.includes("getTokenLargestAccounts")) {
        return new Response(JSON.stringify({
            result: { value: [{ amount: "800" }, { amount: "100" }] },
          }), { headers: { "content-type": "application/json" } });
      }
      if (body.includes("getTokenSupply")) {
        return new Response(JSON.stringify({
            result: { value: { amount: "1000", decimals: 0, uiAmountString: "1000" } },
          }), { headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected ${body}`);
    }) as typeof fetch;
    try {
      const helius = new HeliusOnChainProvider("test-key", "http://helius.test");
      const r = await helius.getTokenRiskInputs("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
      expect(r.tokenProgram).toBe("TOKEN_2022");
      expect(r.mintAuthority).toBe(true);
      expect(r.freezeAuthority).toBe(false);
      expect(r.permanentDelegate).toBe(true);
      expect(r.top5HolderConcentrationPct).toBeCloseTo(90, 5);
    } finally {
      globalThis.fetch = original;
    }
  });
});

function sampleCandidate() {
  return getDemoCandidates().find((c) => c.symbol === "JUP")!;
}

describe("InMemoryDatabase", () => {
  it("write/read, upsert, duplicate proposal id", async () => {
    const db = new InMemoryDatabase(50_000);
    const c = sampleCandidate();
    await db.setCandidates([c]);
    const proposal = {
      id: "22222222-2222-4222-8222-222222222222",
      mint: c.mint,
      symbol: "JUP",
      side: "BUY" as const,
      sizeUsd: 100,
      score: {
        mint: c.mint,
        compositeScore: 70,
        components: {},
        weights: {},
        strategyConfigVersion: "strategy-v1",
        explanation: [],
        scoredAt: nowIso(),
      },
      tokenRisk: {
        mint: c.mint,
        riskScore: 10,
        riskTier: "LOWER_RISK" as const,
        riskFlags: [],
        riskReasons: ["x"],
        dataConfidence: 0.9,
        details: {
          tokenProgram: "TOKEN" as const,
          mintAuthority: false,
          freezeAuthority: false,
          permanentDelegate: false,
          transferRestrictions: false,
          topHolderConcentrationPct: 20,
          liquidityUsd: 1,
          exitLiquidityUsd: 1,
          tokenAgeHours: 1,
          metadataQuality: 1,
          estimatedPriceImpactPct: 0.1,
          missingFields: [],
        },
        assessedAt: nowIso(),
        configVersion: "token-risk-v1.5",
      },
      policy: {
        mint: c.mint,
        decision: "APPROVED" as const,
        reasons: ["ok"],
        matchedRules: [],
        configVersion: "policy-v1",
        assessedAt: nowIso(),
      },
      risk: {
        decision: "APPROVE" as const,
        reasons: [],
        approvedSizeUsd: 100,
        requestedSizeUsd: 100,
        checks: [],
        configVersion: "risk-v1",
        assessedAt: nowIso(),
      },
      signals: [],
      status: "PROPOSED" as const,
      createdAt: nowIso(),
    };
    await db.addProposal(proposal);
    await db.addProposal({ ...proposal, status: "ACCEPTED_PAPER" });
    const state = await db.getState();
    expect(state.mode).toBe("memory");
    expect(state.candidates).toHaveLength(1);
    expect(state.proposals).toHaveLength(1);
    expect(state.proposals[0]?.status).toBe("ACCEPTED_PAPER");
  });
});

// Never reset the application's DATABASE_URL. Opt in with a disposable test database.
const PG_URL = process.env.SENTINEL_TEST_DATABASE_URL?.trim();

describe.skipIf(!PG_URL)("PostgresDatabase", () => {
  beforeEach(async () => {
    const db = new PostgresDatabase(PG_URL!, 25_000);
    try { await db.reset(25_000); } finally { await db.close(); }
  });

  afterAll(async () => {
    /* pool closed per test */
  });

  it("write/read, upsert, duplicate proposal protection, restart/restore", async () => {
    const db = new PostgresDatabase(PG_URL!, 25_000);
    const c = sampleCandidate();
    await db.setCandidates([c]);
    await db.addSignals(c.mint, [
      {
        name: "momentum",
        value: 1,
        normalizedScore: 0.2,
        confidence: 0.8,
        source: "test",
        timestamp: nowIso(),
      },
    ]);
    const proposalId = "33333333-3333-4333-8222-333333333333";
    const base = {
      id: proposalId,
      mint: c.mint,
      symbol: "JUP",
      side: "BUY" as const,
      sizeUsd: 100,
      score: {
        mint: c.mint,
        compositeScore: 70,
        components: {},
        weights: {},
        strategyConfigVersion: "strategy-v1",
        explanation: [],
        scoredAt: nowIso(),
      },
      tokenRisk: {
        mint: c.mint,
        riskScore: 10,
        riskTier: "LOWER_RISK" as const,
        riskFlags: [],
        riskReasons: ["x"],
        dataConfidence: 0.9,
        details: {
          tokenProgram: "TOKEN" as const,
          mintAuthority: false,
          freezeAuthority: false,
          permanentDelegate: false,
          transferRestrictions: false,
          topHolderConcentrationPct: 20,
          liquidityUsd: 1,
          exitLiquidityUsd: 1,
          tokenAgeHours: 1,
          metadataQuality: 1,
          estimatedPriceImpactPct: 0.1,
          missingFields: [],
        },
        assessedAt: nowIso(),
        configVersion: "token-risk-v1.5",
      },
      policy: {
        mint: c.mint,
        decision: "APPROVED" as const,
        reasons: ["ok"],
        matchedRules: [],
        configVersion: "policy-v1",
        assessedAt: nowIso(),
      },
      risk: {
        decision: "APPROVE" as const,
        reasons: [],
        approvedSizeUsd: 100,
        requestedSizeUsd: 100,
        checks: [],
        configVersion: "risk-v1",
        assessedAt: nowIso(),
      },
      signals: [],
      status: "PROPOSED" as const,
      createdAt: nowIso(),
    };
    await db.addProposal(base);
    await db.addProposal({ ...base, status: "ACCEPTED_PAPER" });
    const first = await db.getState();
    expect(first.mode).toBe("postgres");
    expect(first.candidates[0]?.mint).toBe(c.mint);
    expect(first.proposals).toHaveLength(1);
    expect(first.proposals[0]?.status).toBe("ACCEPTED_PAPER");
    expect(first.signals.length).toBeGreaterThan(0);
    await db.close();

    const restored = new PostgresDatabase(PG_URL!, 25_000);
    const second = await restored.getState();
    expect(second.candidates[0]?.symbol).toBe("JUP");
    expect(second.proposals[0]?.id).toBe(proposalId);
    expect(second.proposals[0]?.status).toBe("ACCEPTED_PAPER");
    expect(second.mode).toBe("postgres");
    await restored.close();
  });

  it("atomic consume: second fill of same proposal is rejected", async () => {
    const db = new PostgresDatabase(PG_URL!, 25_000);
    await db.reset(25_000);
    const c = sampleCandidate();
    const proposalId = "44444444-4444-4444-8444-444444444444";
    const p = {
      id: proposalId,
      mint: c.mint,
      symbol: "JUP",
      side: "BUY" as const,
      sizeUsd: 100,
      score: {
        mint: c.mint,
        compositeScore: 70,
        components: {},
        weights: {},
        strategyConfigVersion: "strategy-v1.1",
        explanation: [],
        scoredAt: nowIso(),
      },
      tokenRisk: {
        mint: c.mint,
        riskScore: 10,
        riskTier: "LOWER_RISK" as const,
        riskFlags: [],
        riskReasons: ["x"],
        dataConfidence: 0.9,
        details: {
          tokenProgram: "TOKEN" as const,
          mintAuthority: false,
          freezeAuthority: false,
          permanentDelegate: false,
          transferRestrictions: false,
          topHolderConcentrationPct: 20,
          liquidityUsd: 1,
          exitLiquidityUsd: 1,
          tokenAgeHours: 1,
          metadataQuality: 1,
          estimatedPriceImpactPct: 0.1,
          missingFields: [],
        },
        assessedAt: nowIso(),
        configVersion: "token-risk-v1.5",
      },
      policy: {
        mint: c.mint,
        decision: "APPROVED" as const,
        reasons: ["ok"],
        matchedRules: [],
        configVersion: "policy-v1",
        assessedAt: nowIso(),
      },
      risk: {
        decision: "APPROVE" as const,
        reasons: [],
        approvedSizeUsd: 100,
        requestedSizeUsd: 100,
        checks: [],
        configVersion: "risk-v1",
        assessedAt: nowIso(),
      },
      signals: [],
      status: "PROPOSED" as const,
      createdAt: nowIso(),
    };
    await db.addProposal(p);
    const snap = await db.getState();
    const mkOrder = (id: string) => ({
      id,
      mint: c.mint,
      side: "BUY" as const,
      requestedUsd: 10,
      filledUsd: 10,
      filledQty: 1,
      avgPriceUsd: 10,
      status: "FILLED" as const,
      spreadCostUsd: 0,
      slippageCostUsd: 0,
      impactCostUsd: 0,
      networkCostUsd: 0,
      latencyMs: 1,
      provenance: {
        strategyConfigVersion: "x",
        riskConfigVersion: "x",
        dataSources: [] as string[],
        reasons: [] as string[],
      },
      createdAt: nowIso(),
      updatedAt: nowIso(),
      isDemo: true,
    });
    await db.consumeProposalAndRecordFill({
      proposalId,
      proposal: { ...p, status: "ACCEPTED_PAPER" },
      order: mkOrder("55555555-5555-4555-8555-555555555555"),
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
        proposalId,
        proposal: { ...p, status: "ACCEPTED_PAPER" },
        order: mkOrder("66666666-6666-4666-8666-666666666666"),
        expectedPortfolio: snap.portfolio,
      expectedPositions: snap.positions,
      snapshot: snap.portfolio,
        positions: [],
        events: [],
        navUsd: snap.portfolio.navUsd,
        consumeProposal: true,
      }),
    ).rejects.toMatchObject({ name: "AlreadyExecutedError" });
    const after = await db.getState();
    expect(after.orders).toHaveLength(1);
    expect(after.parseErrors).toBe(0);
    await db.close();
  });
});
