import { afterEach, describe, expect, it, vi } from "vitest";
import { JUP, USDC } from "@sat/shared";
import { fetchJupiterTokenIntel } from "@sat/solana";
import { getSystemHealth, resetProvidersForTests } from "@sat/pipeline";
import { InMemoryDatabase } from "@sat/database";
import { resetObservabilityForTests } from "@sat/observability";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); resetProvidersForTests(); resetObservabilityForTests(); });
describe("provider readiness and token metadata are grounded in actual evidence", () => {
  it("configured providers with no successful request report degraded readiness", async () => {
    vi.stubEnv("HELIUS_API_KEY", "synthetic"); vi.stubEnv("BIRDEYE_API_KEY", "synthetic"); vi.stubEnv("JUPITER_API_KEY", "synthetic");
    resetProvidersForTests(); resetObservabilityForTests();
    const health = await getSystemHealth(new InMemoryDatabase());
    expect(health.healthStatus).toBe("degraded");
    expect(health.providerHealth.every((p) => p.isDemo || (p.status === "degraded" && p.lastSuccessAt === null))).toBe(true);
    expect(health.canBroadcast).toBe(false);
  });
  it("an unrelated verified token can never verify the requested mint", async () => {
    vi.stubEnv("JUPITER_API_KEY", "synthetic");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{ id: USDC, isVerified: true, organicScore: 99 }]))));
    expect(await fetchJupiterTokenIntel(JUP)).toMatchObject({ verified: null, organicScore: null });
  });
  it.each([null, "bad", -1, 101])("missing or invalid organic score %s is unknown rather than zero/clamped", async (organicScore) => {
    vi.stubEnv("JUPITER_API_KEY", "synthetic");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{ id: JUP, organicScore }]))));
    expect((await fetchJupiterTokenIntel(JUP)).organicScore).toBeNull();
  });
  it("malformed response does not expose credential-bearing network errors", async () => {
    vi.stubEnv("JUPITER_API_KEY", "synthetic");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("synthetic-credential-in-url"); }));
    const result = await fetchJupiterTokenIntel(JUP);
    expect(result.source).toBe("jupiter-tokens request-failed");
    expect(JSON.stringify(result)).not.toContain("credential-in-url");
  });
});
