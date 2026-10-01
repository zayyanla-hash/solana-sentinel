import { describe, expect, it } from "vitest";
import { getDemoCandidates } from "@sat/shared";
import { BirdeyeMarketDataProvider, DemoMarketDataProvider } from "@sat/market-data";
import { DemoOnChainProvider, HeliusOnChainProvider } from "@sat/solana";
import { assessTokenRisk } from "@sat/token-risk";

const knownMint = getDemoCandidates().find((a) => a.symbol === "JUP")!.mint;

describe("configured real providers fail closed for known demo mints", () => {
  it("Birdeye failure returns no asset or OHLCV, while the explicit demo provider stays usable", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("provider offline"); }) as typeof fetch;
    try {
      const real = new BirdeyeMarketDataProvider("test-key", "https://birdeye.test");
      expect(await real.getAsset(knownMint)).toBeNull();
      expect(await real.getOhlcv(knownMint, "1h", 30)).toEqual([]);
      const demo = new DemoMarketDataProvider();
      expect((await demo.getAsset(knownMint))?.isDemo).toBe(true);
      expect((await demo.getOhlcv(knownMint, "1h", 30))).toHaveLength(30);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("Helius failure yields unknown authority risk, not a clean demo profile", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("provider offline"); }) as typeof fetch;
    try {
      const real = new HeliusOnChainProvider("test-key", "https://helius.test");
      const inputs = await real.getTokenRiskInputs(knownMint);
      expect(inputs.tokenProgram).toBe("UNKNOWN");
      expect(inputs.mintAuthority).toBeNull();
      expect(inputs.freezeAuthority).toBeNull();
      expect(assessTokenRisk(getDemoCandidates()[0]!, inputs).riskTier).toBe("INSUFFICIENT_DATA");
      const demo = await new DemoOnChainProvider().getTokenRiskInputs(knownMint);
      expect(demo.tokenProgram).toBe("TOKEN");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("malformed Helius asset metadata leaves authority fields unknown", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ result: {} }),
      { headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      const inputs = await new HeliusOnChainProvider("test-key", "https://helius.test")
        .getTokenRiskInputs(knownMint);
      expect(inputs.tokenProgram).toBe("UNKNOWN");
      expect(inputs.mintAuthority).toBeNull();
      expect(inputs.freezeAuthority).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });
});
