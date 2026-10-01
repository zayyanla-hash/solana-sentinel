import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ExecutionPlanSchema,
  ExecutionQuoteSchema,
  isLiveTradingAllowed,
  getDemoCandidates,
  nowIso,
  type TradeProposal,
} from "@sat/shared";
import { resetDatabaseForTests } from "@sat/database";
import { executePaperProposal } from "@sat/pipeline";
import { PolicyEngine } from "@sat/policy-engine";
import { assessTokenRisk } from "@sat/token-risk";
import { RiskEngine } from "@sat/risk-engine";
import { DEFAULT_POLICY_CONFIG, DEFAULT_RISK_CONFIG } from "@sat/shared";

const jup = getDemoCandidates().find((c) => c.symbol === "JUP")!;

function listTsFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".next") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) listTsFiles(p, acc);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) acc.push(p);
  }
  return acc;
}

function quoteFixture() {
  return ExecutionQuoteSchema.parse({
    inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    outputMint: jup.mint,
    inAmount: "1000000",
    outAmount: "997000",
    priceImpactPct: 0.1,
    slippageBps: 50,
    routeLabels: ["TEST"],
    feeEstimateUsd: 0,
    provider: "demo",
    quotedAt: nowIso(),
    isDemo: true,
  });
}

function proposalFixture(overrides: Partial<TradeProposal> = {}): TradeProposal {
  const tokenRisk = assessTokenRisk(jup, {
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
  const { assessment: policy } = new PolicyEngine(DEFAULT_POLICY_CONFIG).evaluate(jup);
  const { result: risk } = new RiskEngine(DEFAULT_RISK_CONFIG).evaluate(jup, {
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
      mint: jup.mint,
      compositeScore: 80,
      components: {},
      weights: {},
      strategyConfigVersion: "strategy-v1",
      explanation: ["test"],
      scoredAt: nowIso(),
    },
    estimatedPriceImpactPct: 0.2,
    slippageBps: 50,
  });
  return {
    id: "11111111-1111-4111-8111-111111111111",
    mint: jup.mint,
    symbol: "JUP",
    side: "BUY",
    sizeUsd: 1000,
    score: {
      mint: jup.mint,
      compositeScore: 80,
      components: {},
      weights: {},
      strategyConfigVersion: "strategy-v1",
      explanation: ["test"],
      scoredAt: nowIso(),
    },
    tokenRisk,
    policy,
    risk,
    signals: [],
    status: "PROPOSED",
    createdAt: nowIso(),
    ...overrides,
  };
}

describe("P0 invariants", () => {
  beforeEach(() => {
    resetDatabaseForTests(100_000);
  });

  it("isLiveTradingAllowed is hard-false", () => {
    expect(isLiveTradingAllowed()).toBe(false);
  });

  it("ExecutionPlanSchema.canBroadcast is literal false", () => {
    const quote = quoteFixture();
    const ok = ExecutionPlanSchema.safeParse({
      quote,
      mode: "PAPER",
      canBroadcast: false,
      notes: ["test"],
      plannedAt: nowIso(),
    });
    expect(ok.success).toBe(true);
    const bad = ExecutionPlanSchema.safeParse({
      quote,
      mode: "PAPER",
      canBroadcast: true,
      notes: ["test"],
      plannedAt: nowIso(),
    });
    expect(bad.success).toBe(false);
  });

  it("source tree has no wallet signing or broadcast implementation", () => {
    const roots = [join(process.cwd(), "packages"), join(process.cwd(), "apps")];
    const files = roots.flatMap((r) => listTsFiles(r));
    const hits: string[] = [];
    const forbidden =
      /\b(sendTransaction|sendRawTransaction|signTransaction|signAllTransactions|signAndSendTransaction|Keypair\.fromSecretKey|fromSeed\(|nacl\.sign|tweetnacl)\b/;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const [i, line] of text.split("\n").entries()) {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("* ")) {
          continue;
        }
        if (forbidden.test(line)) {
          hits.push(`${file}:${i + 1}:${trimmed}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("policy / token-risk / portfolio-risk rejections are independent", () => {
    const policyEngine = new PolicyEngine(DEFAULT_POLICY_CONFIG);
    const riskEngine = new RiskEngine(DEFAULT_RISK_CONFIG);
    const cleanOnChain = {
      tokenProgram: "TOKEN" as const,
      mintAuthority: false,
      freezeAuthority: false,
      permanentDelegate: false,
      transferRestrictions: false,
      topHolderConcentrationPct: 20,
      exitLiquidityUsd: 5_000_000,
      estimatedPriceImpactPct: 0.2,
      metadataQuality: 0.9,
    };
    const cleanRisk = assessTokenRisk(jup, cleanOnChain);
    expect(cleanRisk.riskTier).not.toBe("HIGH_RISK");
    const { assessment: cleanPolicy } = policyEngine.evaluate(jup);
    expect(cleanPolicy.decision).toBe("APPROVED");

    const hostileName = {
      ...jup,
      name: "Casino Leverage Perp",
      metadata: { description: "interest bearing gambling" },
    };
    const { assessment: policyReject } = policyEngine.evaluate(hostileName);
    expect(policyReject.decision).toBe("REJECTED");
    expect(assessTokenRisk(hostileName, cleanOnChain).riskTier).not.toBe("HIGH_RISK");

    const tokenReject = assessTokenRisk(jup, {
      ...cleanOnChain,
      mintAuthority: true,
      freezeAuthority: true,
      permanentDelegate: true,
      transferRestrictions: true,
      topHolderConcentrationPct: 95,
      exitLiquidityUsd: 1_000,
      estimatedPriceImpactPct: 20,
    });
    expect(tokenReject.riskTier).toBe("HIGH_RISK");
    expect(policyEngine.evaluate(jup).assessment.decision).toBe("APPROVED");

    const { result: riskReject } = riskEngine.evaluate(jup, {
      portfolio: {
        timestamp: nowIso(),
        navUsd: 100_000,
        cashUsd: 100_000,
        positionsValueUsd: 0,
        drawdownPct: 0.5,
        peakNavUsd: 100_000,
      },
      positions: [],
      requestedSizeUsd: 1000,
      score: {
        mint: jup.mint,
        compositeScore: 80,
        components: {},
        weights: {},
        strategyConfigVersion: "strategy-v1",
        explanation: [],
        scoredAt: nowIso(),
      },
    });
    expect(riskReject.decision).toBe("REJECT");
    expect(policyEngine.evaluate(jup).assessment.decision).toBe("APPROVED");
    expect(assessTokenRisk(jup, cleanOnChain).riskTier).not.toBe("HIGH_RISK");
  });

  it("execute-time policy gate blocks even when token-risk and portfolio-risk would pass", async () => {
    const db = resetDatabaseForTests(100_000);
    await db.setCandidates([jup]);
    const p = proposalFixture({
      policy: {
        mint: jup.mint,
        decision: "REJECTED",
        reasons: ["test policy reject"],
        matchedRules: ["test"],
        configVersion: "policy-v1",
        assessedAt: nowIso(),
      },
    });
    await db.addProposal(p);
    await expect(executePaperProposal(p.id, db)).rejects.toThrow(/Policy not APPROVED/i);
  });

  it("execute-time token-risk gate blocks even when policy is APPROVED", async () => {
    const db = resetDatabaseForTests(100_000);
    await db.setCandidates([jup]);
    const p = proposalFixture({
      tokenRisk: {
        ...proposalFixture().tokenRisk,
        riskTier: "HIGH_RISK",
        riskScore: 90,
        riskReasons: ["test high risk"],
      },
    });
    await db.addProposal(p);
    await expect(executePaperProposal(p.id, db)).rejects.toThrow(/Token-risk gate/i);
  });

  it("execute-time portfolio-risk gate blocks even when policy is APPROVED", async () => {
    const db = resetDatabaseForTests(100_000);
    await db.setCandidates([jup]);
    const p = proposalFixture({
      risk: {
        ...proposalFixture().risk,
        decision: "REJECT",
        approvedSizeUsd: 0,
        reasons: ["test risk reject"],
      },
    });
    await db.addProposal(p);
    await expect(executePaperProposal(p.id, db)).rejects.toThrow(/Risk REJECT/i);
  });
});
