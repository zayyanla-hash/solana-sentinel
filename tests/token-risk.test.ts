import { describe, it, expect } from "vitest";
import { assessTokenRisk } from "@sat/token-risk";
import { getDemoCandidates } from "@sat/shared";

describe("token-risk", () => {
  it("never returns SAFE tier", () => {
    const asset = getDemoCandidates().find((c) => c.symbol === "JUP")!;
    const a = assessTokenRisk(asset, {
      tokenProgram: "TOKEN",
      mintAuthority: false,
      freezeAuthority: false,
      permanentDelegate: false,
      transferRestrictions: false,
      topHolderConcentrationPct: 20,
      exitLiquidityUsd: 5_000_000,
      estimatedPriceImpactPct: 0.2,
      metadataQuality: 0.9,
    });
    expect(a.riskTier).not.toBe("SAFE" as never);
    expect(["LOWER_RISK", "ELEVATED_RISK", "HIGH_RISK", "INSUFFICIENT_DATA"]).toContain(
      a.riskTier,
    );
  });

  it("flags high-risk scam-like token", () => {
    const asset = getDemoCandidates().find((c) => c.symbol === "SCAMX")!;
    const a = assessTokenRisk(asset, {
      tokenProgram: "TOKEN_2022",
      mintAuthority: true,
      freezeAuthority: true,
      permanentDelegate: true,
      transferRestrictions: true,
      topHolderConcentrationPct: 92,
      exitLiquidityUsd: 3000,
      estimatedPriceImpactPct: 18,
      metadataQuality: 0.2,
    });
    expect(a.riskScore).toBeGreaterThanOrEqual(70);
    expect(a.riskTier).toBe("HIGH_RISK");
    expect(a.riskFlags.length).toBeGreaterThan(3);
  });

  it("returns INSUFFICIENT_DATA when confidence low", () => {
    const asset = getDemoCandidates().find((c) => c.symbol === "JUP")!;
    const a = assessTokenRisk(
      { ...asset, liquidityUsd: null, tokenAgeHours: null, holderCount: null },
      {},
    );
    expect(a.riskTier).toBe("INSUFFICIENT_DATA");
    expect(a.details.missingFields.length).toBeGreaterThan(0);
  });
});

const jup = getDemoCandidates().find((c) => c.symbol === "JUP")!;

describe("token-risk v1.5 fixtures", () => {
  it("benign token is LOWER_RISK, never SAFE", () => {
    const a = assessTokenRisk(jup, {
      tokenProgram: "TOKEN",
      mintAuthority: false,
      freezeAuthority: false,
      permanentDelegate: false,
      transferRestrictions: false,
      transferHook: false,
      token2022Extensions: [],
      topHolderConcentrationPct: 18,
      top5HolderConcentrationPct: 14,
      top10HolderConcentrationPct: 18,
      exitLiquidityUsd: 8_000_000,
      estimatedPriceImpactPct: 0.15,
      metadataQuality: 0.95,
    });
    expect(a.riskTier).not.toBe("SAFE" as never);
    expect(a.riskTier).toBe("LOWER_RISK");
    expect(a.configVersion).toBe("token-risk-v2");
  });

  it("mint authority alone elevates risk", () => {
    const a = assessTokenRisk(jup, {
      tokenProgram: "TOKEN",
      mintAuthority: true,
      freezeAuthority: false,
      permanentDelegate: false,
      transferRestrictions: false,
      transferHook: false,
      token2022Extensions: [],
      top5HolderConcentrationPct: 20,
      top10HolderConcentrationPct: 28,
      exitLiquidityUsd: 5_000_000,
      estimatedPriceImpactPct: 0.2,
      metadataQuality: 0.9,
    });
    expect(a.riskFlags).toContain("MINT_AUTHORITY");
    expect(a.riskScore).toBeGreaterThanOrEqual(18);
  });

  it("freeze authority is flagged independently", () => {
    const a = assessTokenRisk(jup, {
      tokenProgram: "TOKEN",
      mintAuthority: false,
      freezeAuthority: true,
      permanentDelegate: false,
      transferRestrictions: false,
      transferHook: false,
      token2022Extensions: [],
      top5HolderConcentrationPct: 20,
      top10HolderConcentrationPct: 28,
      exitLiquidityUsd: 5_000_000,
      estimatedPriceImpactPct: 0.2,
      metadataQuality: 0.9,
    });
    expect(a.riskFlags).toContain("FREEZE_AUTHORITY");
  });

  it("concentrated holders flag top-5/10", () => {
    const a = assessTokenRisk(jup, {
      tokenProgram: "TOKEN",
      mintAuthority: false,
      freezeAuthority: false,
      permanentDelegate: false,
      transferRestrictions: false,
      transferHook: false,
      token2022Extensions: [],
      top5HolderConcentrationPct: 81,
      top10HolderConcentrationPct: 90,
      exitLiquidityUsd: 5_000_000,
      estimatedPriceImpactPct: 0.2,
      metadataQuality: 0.9,
    });
    expect(a.riskFlags.join(" ")).toMatch(/HOLDER_CONCENTRATION/);
    expect(a.details.top5HolderConcentrationPct).toBe(81);
    expect(a.details.top10HolderConcentrationPct).toBe(90);
  });

  it("Token-2022 permanent delegate is HIGH_RISK material", () => {
    const a = assessTokenRisk(jup, {
      tokenProgram: "TOKEN_2022",
      mintAuthority: false,
      freezeAuthority: false,
      permanentDelegate: true,
      transferRestrictions: false,
      transferHook: false,
      token2022Extensions: ["permanent_delegate"],
      top5HolderConcentrationPct: 20,
      top10HolderConcentrationPct: 28,
      exitLiquidityUsd: 5_000_000,
      estimatedPriceImpactPct: 0.2,
      metadataQuality: 0.9,
    });
    expect(a.riskFlags).toContain("PERMANENT_DELEGATE");
    expect(a.riskScore).toBeGreaterThanOrEqual(25);
  });

  it("transfer-hook is flagged and not assumed safe", () => {
    const a = assessTokenRisk(jup, {
      tokenProgram: "TOKEN_2022",
      mintAuthority: false,
      freezeAuthority: false,
      permanentDelegate: false,
      transferRestrictions: true,
      transferHook: true,
      token2022Extensions: ["transfer_hook"],
      top5HolderConcentrationPct: 20,
      top10HolderConcentrationPct: 28,
      exitLiquidityUsd: 5_000_000,
      estimatedPriceImpactPct: 0.2,
      metadataQuality: 0.9,
    });
    expect(a.riskFlags).toContain("TRANSFER_HOOK");
    expect(a.details.transferHook).toBe(true);
  });

  it("returns INSUFFICIENT_DATA when required on-chain fields are unknown even if liquidity is rich", () => {
    const rich = {
      ...jup,
      liquidityUsd: 600_000,
      marketCapUsd: 50_000_000,
      isDemo: false,
      dataSources: ["birdeye"],
    };
    const a = assessTokenRisk(rich, {
      tokenProgram: "UNKNOWN",
      mintAuthority: null,
      freezeAuthority: null,
      permanentDelegate: null,
      transferRestrictions: null,
      transferHook: null,
      token2022Extensions: null,
      topHolderConcentrationPct: null,
      top5HolderConcentrationPct: null,
      top10HolderConcentrationPct: null,
      exitLiquidityUsd: null,
      estimatedPriceImpactPct: null,
      metadataQuality: null,
    });
    expect(a.riskTier).toBe("INSUFFICIENT_DATA");
    expect(a.riskReasons[0]).toMatch(/MISSING_REQUIRED/);
    expect(a.riskTier).not.toBe("LOWER_RISK");
  });

  it("incomplete data prefers INSUFFICIENT_DATA over optimistic defaults", () => {
    const a = assessTokenRisk(
      { ...jup, liquidityUsd: null, tokenAgeHours: null, holderCount: null },
      { tokenProgram: "UNKNOWN" },
    );
    expect(a.riskTier).toBe("INSUFFICIENT_DATA");
    expect(a.details.mintAuthority).toBeNull();
    expect(a.details.permanentDelegate).toBeNull();
    expect(a.details.transferHook).toBeNull();
    expect(a.details.missingFields.length).toBeGreaterThan(3);
  });
});
