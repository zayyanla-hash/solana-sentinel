import { describe, expect, it } from "vitest";
import {
  InMemoryIntelligenceEventStore,
  IntelligenceEventSchema,
  INTELLIGENCE_EVENT_VERSION,
  demoIntelligenceEvents,
  type IntelligenceEvent,
} from "../packages/intelligence-events/src/index";

function event(id: string, timestamp = "2026-09-24T10:00:00.000Z"): IntelligenceEvent {
  return {
    id,
    version: INTELLIGENCE_EVENT_VERSION,
    type: "WALLET_MIGRATION",
    chain: "SOLANA",
    asset: "DestinationMint",
    timestamp,
    score: null,
    confidence: null,
    severity: "INFO",
    metrics: { uniqueWallets: 2, netCapitalUsd: null },
    evidence: [{ source: "fixture", sourceId: `signature-${id}`, observedAt: "2026-09-24T09:00:00.000Z" }],
    provenance: { provider: "fixture", datasetVersion: "fixture-v1", algorithmVersion: "migration-v1", isDemo: true },
    strategyVersion: null,
    dataQuality: "DEMO",
  };
}

describe("intelligence event query contract", () => {
  it("ships an explicitly synthetic example with no fabricated score", () => {
    const fixture = demoIntelligenceEvents()[0]!;
    expect(fixture.provenance.isDemo).toBe(true);
    expect(fixture.dataQuality).toBe("DEMO");
    expect(fixture.score).toBeNull();
    expect(fixture.confidence).toBeNull();
  });

  it("retains evidence, filters and paginates with stable ordering", async () => {
    const store = new InMemoryIntelligenceEventStore();
    await store.append([event("b"), event("a"), event("c", "2026-09-24T11:00:00.000Z")]);
    const page = await store.query({ type: "WALLET_MIGRATION", asset: "DestinationMint", isDemo: true, limit: 2 });
    expect(page.items.map((row) => row.id)).toEqual(["c", "a"]);
    expect(page.total).toBe(3);
    expect(page.items[0]?.evidence[0]?.sourceId).toBe("signature-c");
    expect((await store.query({ offset: 2, limit: 2 })).items.map((row) => row.id)).toEqual(["b"]);
  });

  it("rejects duplicate IDs and future evidence without partially writing a batch", async () => {
    const store = new InMemoryIntelligenceEventStore();
    const future = event("future");
    future.evidence[0]!.observedAt = "2026-09-24T12:00:00.000Z";
    await expect(store.append([event("good"), future])).rejects.toThrow("Evidence after event timestamp");
    expect((await store.query()).total).toBe(0);
    await expect(store.append([event("same"), event("same")])).rejects.toThrow("Duplicate intelligence event");
  });

  it("validates scores and prevents callers mutating stored evidence", async () => {
    expect(IntelligenceEventSchema.safeParse({ ...event("bad"), confidence: 3 }).success).toBe(false);
    expect(IntelligenceEventSchema.safeParse({ ...event("mislabelled"), provenance: { ...event("mislabelled").provenance, isDemo: false } }).success).toBe(false);
    const store = new InMemoryIntelligenceEventStore();
    const original = event("one");
    await store.append([original]);
    original.evidence[0]!.sourceId = "changed";
    const first = (await store.query()).items[0]!;
    first.evidence[0]!.sourceId = "changed again";
    expect((await store.query()).items[0]!.evidence[0]!.sourceId).toBe("signature-one");
    await expect(store.query({ limit: 101 })).rejects.toThrow("Invalid limit");
  });

  it("compares time filters by instant across valid UTC spellings", async () => {
    const store = new InMemoryIntelligenceEventStore();
    await store.append([event("boundary", "2026-09-24T10:00:00Z")]);
    expect((await store.query({ from: "2026-09-24T10:00:00.000Z", through: "2026-09-24T10:00:00.000Z" })).total).toBe(1);
    await expect(store.query({ from: "2026-09-24T10:00:00" })).rejects.toThrow(/timezone required/);
  });
});
