import { describe, it, expect, afterEach } from "vitest";
import { isPublicDemo, isLiveTradingAllowed } from "@sat/shared";
import { buildPoolConfig } from "@sat/database";
import { assertQuoteOnlyJupiterUrl, JupiterExecutionProvider } from "@sat/execution";
import { mutatingRequestDenied, ActionSchema } from "../apps/web/src/lib/request-guard";
import { computePerformance, equalWeightSeries } from "@sat/analytics";
import { runExperimentReplay } from "@sat/experiments";

describe("V2 public demo and provider honesty", () => {
  const prev = {
    PUBLIC_DEMO: process.env.PUBLIC_DEMO,
    SAT_API_TOKEN: process.env.SAT_API_TOKEN,
    SAT_BIND_HOST: process.env.SAT_BIND_HOST,
    DATABASE_SSL: process.env.DATABASE_SSL,
    DATABASE_SSL_REJECT_UNAUTHORIZED: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED,
  };

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("isLiveTradingAllowed remains false", () => {
    expect(isLiveTradingAllowed()).toBe(false);
  });

  it("PUBLIC_DEMO blocks anonymous mutations and allows operator token", () => {
    process.env.PUBLIC_DEMO = "true";
    process.env.SAT_API_TOKEN = "test-operator-token";
    process.env.SAT_BIND_HOST = "127.0.0.1";
    const anon = mutatingRequestDenied(
      new Request("http://127.0.0.1:4317/api/state", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:4317", host: "127.0.0.1:4317" },
      }),
    );
    expect(anon?.code).toBe("PUBLIC_DEMO_READONLY");

    const op = mutatingRequestDenied(
      new Request("http://127.0.0.1:4317/api/state", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:4317",
          host: "127.0.0.1:4317",
          authorization: "Bearer test-operator-token",
        },
      }),
    );
    expect(op).toBeNull();
  });

  it("set_mode remains an invalid action", () => {
    expect(ActionSchema.safeParse({ action: "set_mode", mode: "LIVE" }).success).toBe(false);
  });

  it("Jupiter quote-only URL guard rejects execute/submit", () => {
    expect(() => assertQuoteOnlyJupiterUrl("https://api.jup.ag/swap/v2/order")).not.toThrow();
    expect(() => assertQuoteOnlyJupiterUrl("https://api.jup.ag/swap/v2/execute")).toThrow(/Forbidden/);
    expect(() => assertQuoteOnlyJupiterUrl("https://api.jup.ag/swap/v2/submit")).toThrow(/Forbidden/);
  });

  it("Jupiter v2 provider name and plan stay paper-only", async () => {
    const jup = new JupiterExecutionProvider("https://api.jup.ag/swap/v2", undefined);
    expect(jup.name).toBe("jupiter-swap-v2");
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          outputMint: "So11111111111111111111111111111111111111112",
          inAmount: "1000000",
          outAmount: "990000",
          priceImpactPct: 0.01,
          slippageBps: 50,
          router: "metis",
          routePlan: [],
        }),
      }) as Response) as typeof fetch;
    try {
      const quote = await jup.quote({
        inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        outputMint: "So11111111111111111111111111111111111111112",
        amount: "1000000",
      });
      expect(quote.isDemo).toBe(false);
      expect(quote.provider).toBe("jupiter-swap-v2");
      const plan = await jup.plan(quote, "PAPER");
      expect(plan.canBroadcast).toBe(false);
      expect(plan.mode).toBe("PAPER");
      expect(plan.notes.join(" ")).toMatch(/execute is not implemented/i);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("remote DATABASE_URL verifies TLS; local stays plaintext unless configured", () => {
    delete process.env.DATABASE_SSL;
    delete process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;
    const hosted = buildPoolConfig("postgres://user:pass@db.xxx.supabase.co:5432/postgres");
    expect(hosted.ssl).toEqual({ rejectUnauthorized: true });
    const remote = buildPoolConfig("postgres://user:pass@db.example.com:5432/postgres");
    expect(remote.ssl).toEqual({ rejectUnauthorized: true });
    const required = buildPoolConfig("postgres://user:pass@db.example.com:5432/postgres?sslmode=require");
    expect(required.ssl).toEqual({ rejectUnauthorized: true });
    expect(required.connectionString).not.toContain("sslmode=");
    const local = buildPoolConfig("postgres://sat:sat@127.0.0.1:5432/sat_test");
    expect(local.ssl).toBeUndefined();
    expect(() => buildPoolConfig("postgres://user:pass@db.example.com:5432/postgres?sslmode=disable"))
      .toThrow("DATABASE_TLS_REQUIRED");
    expect(() => buildPoolConfig("postgres://user:pass@db.example.com:5432/postgres?sslmode=no-verify"))
      .toThrow("DATABASE_TLS_VERIFICATION_REQUIRED");
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = "false";
    expect(buildPoolConfig("postgres://user:pass@db.example.com:5432/postgres?sslmode=require").ssl)
      .toEqual({ rejectUnauthorized: false });
  });

  it("isPublicDemo reads env honestly", () => {
    delete process.env.PUBLIC_DEMO;
    expect(isPublicDemo()).toBe(false);
    process.env.PUBLIC_DEMO = "true";
    expect(isPublicDemo()).toBe(true);
  });

  it("equal-weight baseline is deterministic and metrics hide thin samples", () => {
    const ew = equalWeightSeries([
      [10, 11, 12],
      [20, 22, 24],
    ]);
    expect(ew[0]).toBe(1);
    expect(ew[2]).toBeCloseTo(1.2, 8);
    const thin = computePerformance([100, 101]);
    expect(thin.hitRate).toBeNull();
    const exp = runExperimentReplay({
      name: "unit",
      strategyEquity: Array.from({ length: 12 }, (_, i) => 100 + i),
      startingCapital: 100,
      candidatePriceSeries: [
        [10, 10.5, 11, 11.2, 11.1, 11.4, 11.8, 12, 12.1, 12.2, 12.4, 12.5],
      ],
      isDemo: true,
    });
    expect(exp.baselines.equalWeightCandidates).not.toBeNull();
  });
});
