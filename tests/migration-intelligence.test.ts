import { describe, expect, it } from "vitest";
import type { WalletTrade } from "@sat/shared";
import { detectWalletMigrations } from "../packages/wallet-migration/src/index";
import { eventFromWalletMigration, InMemoryIntelligenceEventStore } from "../packages/intelligence-events/src/index";

const wallet = "11111111111111111111111111111111";
const source = "EPjFWdd5AufqSSqeM2q8s8F6e3mZ9Z6jF4nZ4eF8qH8";
const destination = "So11111111111111111111111111111111111111112";

function leg(signature: string, timestamp: string, side: "SELL" | "BUY", mint: string): WalletTrade {
  return {
    signature, timestamp, side, mint, usdNotional: 100, qty: 1, priceUsd: null,
    tokenAgeHoursAtEntry: null, liquidityUsdAtEntry: null, slippageBps: null,
    provider: "synthetic-fixture", isDemo: true,
  };
}

describe("migration to intelligence event boundary", () => {
  it("preserves exact evidence and a causal event timestamp", async () => {
    const result = detectWalletMigrations({
      tradesByWallet: { [wallet]: [
        leg("sell-1", "2026-09-24T10:00:00.000Z", "SELL", source),
        leg("buy-1", "2026-09-24T10:05:00.000Z", "BUY", destination),
      ] },
      asOf: "2026-09-24T11:00:00.000Z",
    });
    const event = eventFromWalletMigration(result.migrations[0]!, {
      provider: "synthetic-fixture", datasetVersion: "demo-v1", algorithmVersion: result.version,
    });
    const store = new InMemoryIntelligenceEventStore();
    await store.append([event]);
    const page = await store.query({ type: "WALLET_MIGRATION", asset: destination });
    expect(page.total).toBe(1);
    expect(page.items[0]?.timestamp).toBe("2026-09-24T10:05:00.000Z");
    expect(page.items[0]?.evidence.map((e) => e.sourceId)).toEqual(["sell-1", "buy-1"]);
    expect(page.items[0]?.metrics.estimatedMigratedNotionalUsd).toBe(100);
    expect(page.items[0]?.score).toBeNull();
    expect(page.items[0]?.dataQuality).toBe("DEMO");
    expect(eventFromWalletMigration({ ...result.migrations[0]!, isDemo: false }, {
      provider: "fixture", datasetVersion: "test-v1", algorithmVersion: result.version,
    }).dataQuality).toBe("PARTIAL");
  });
});
