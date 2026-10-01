import { describe, expect, it } from "vitest";
import { DemoStreamProvider, HeliusStreamProvider, type ChainEvent } from "@sat/streaming";

describe("stream capability and health evidence", () => {
  it("unimplemented Helius subscriptions fail and injected events never imply live health", async () => {
    const p = new HeliusStreamProvider("synthetic-key");
    for (const subscribe of [() => p.subscribeWallet("wallet"), () => p.subscribeToken("mint"), () => p.subscribeProgram("program"), () => p.subscribeTransactions()]) {
      await expect(subscribe()).rejects.toThrow("helius-stream-not-implemented");
    }
    let deliveries = 0;
    p.onEvent(() => deliveries++);
    const ev: ChainEvent = { id: "id-a", signature: "synthetic-sig", kind: "TRANSACTION", address: "wallet", timestamp: new Date().toISOString(), payload: {}, isDemo: true };
    p.ingest(ev); p.ingest({ ...ev, id: "different-delivery-id" });
    expect(deliveries).toBe(1);
    expect(p.health()).toMatchObject({ status: "unavailable", connected: false, reconnects: 0, reason: "helius-stream-not-implemented" });
    await p.close(); p.ingest({ ...ev, signature: "different" });
    expect(deliveries).toBe(1);
  });
  it("demo heartbeat stops after close and stays explicitly demo", async () => {
    const p = new DemoStreamProvider();
    await p.subscribeTransactions();
    expect(p.health().status).toBe("demo_fallback");
    await p.close();
    expect(p.health().connected).toBe(false);
  });
});
