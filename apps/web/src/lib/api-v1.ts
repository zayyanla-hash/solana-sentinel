import { NextResponse } from "next/server";
import { z } from "zod";
import {
  SolanaAddressSchema,
  StrategyLabConfigSchema,
  isPublicDemo,
} from "@sat/shared";
import { getDatabase } from "@sat/database";
import {
  getSystemHealth,
  getOperatingMode,
  evaluateMint,
  generateSmartMoneySignals,
  analyzeWallet,
  listWalletIntelligence,
  walletGraphForDemo,
  runStrategyLab,
  createAlertRule,
} from "@sat/pipeline";
import { assessTokenRisk } from "@sat/token-risk";
import { getProviders } from "@sat/pipeline";
import { entitlementsFor, parseTier } from "@sat/entitlements";
import { rateLimitAllow, requestId, getAnalytics, recordUsage } from "@sat/observability";
import { DEMO_WALLETS } from "@sat/wallet-intel";
import { mutatingRequestDenied } from "@/lib/request-guard";

export function apiError(error: string, code: string, status: number, rid: string) {
  return NextResponse.json(
    { error, code, requestId: rid, version: "v1" },
    { status, headers: { "x-request-id": rid } },
  );
}

export function apiOk(data: unknown, rid: string, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { data, requestId: rid, version: "v1", ...extra },
    { headers: { "x-request-id": rid } },
  );
}

export async function handleV1(req: Request, path: string[]): Promise<NextResponse> {
  const rid = req.headers.get("x-request-id") ?? requestId();
  const ip = req.headers.get("x-forwarded-for") ?? "local";
  if (!rateLimitAllow(`v1:${ip}`, 120, 2)) {
    return apiError("Rate limit exceeded", "RATE_LIMITED", 429, rid);
  }
  recordUsage({ subject: ip, action: path.join("/"), units: 1, estimatedCostUsd: 0, provider: "sentinel-api" });
  getAnalytics().track("api_used", { path: path.join("/") });

  const db = getDatabase();
  const tier = parseTier(req.headers.get("x-sentinel-tier"));
  const entitlements = entitlementsFor(tier);
  const [a, b, c] = path;

  try {
    if (a === "health" && !b) {
      const health = await getSystemHealth(db);
      return apiOk(
        {
          ...health,
          liveTradingAllowed: false,
          canBroadcast: false,
        },
        rid,
        { freshness: new Date().toISOString() },
      );
    }

    if (a === "entitlements" && !b) {
      return apiOk({ entitlements, publicDemo: isPublicDemo() }, rid);
    }

    if (a === "market" && b === "regime") {
      const state = await db.getState();
      const regime = state.signals.find((s) => s.name === "market_regime");
      return apiOk(
        {
          regime: regime?.meta?.regime ?? "UNKNOWN",
          confidence: regime?.confidence ?? null,
          provenance: regime?.source ?? "none",
        },
        rid,
      );
    }

    if (a === "opportunities") {
      const state = await db.getState();
      return apiOk(
        {
          candidates: state.candidates,
          scores: state.scores,
          delayedMinutes: entitlements.delayedFeedMinutes,
        },
        rid,
        { isDemo: state.candidates.some((x) => x.isDemo) },
      );
    }

    if (a === "signals" && !b) {
      const signals = await generateSmartMoneySignals(db);
      return apiOk({ signals }, rid);
    }

    if (a === "wallets" && !b) {
      return apiOk({ wallets: await listWalletIntelligence(), demoAddresses: DEMO_WALLETS }, rid);
    }

    if (a === "wallets" && b === "graph") {
      if (!entitlements.walletClustering) {
        return apiError("Wallet clustering requires ADVANCED entitlement", "ENTITLEMENT_DENIED", 402, rid);
      }
      return apiOk(await walletGraphForDemo(), rid);
    }

    if (a === "wallet" && b) {
      const parsed = SolanaAddressSchema.safeParse(b);
      if (!parsed.success) return apiError("Invalid wallet", "INVALID_ADDRESS", 400, rid);
      getAnalytics().track("wallet_analyzed", { wallet: b });
      const score = await analyzeWallet(parsed.data);
      if (c === "score" || !c) return apiOk({ score }, rid);
      if (c === "activity") {
        return apiOk({ score, sampleSize: score.sampleSize, freshness: score.dataFreshness }, rid);
      }
      return apiError("Unknown wallet subresource", "NOT_FOUND", 404, rid);
    }

    if (a === "token" && b) {
      const parsed = SolanaAddressSchema.safeParse(b);
      if (!parsed.success) return apiError("Invalid mint", "INVALID_ADDRESS", 400, rid);
      getAnalytics().track("token_analyzed", { mint: b });
      const state = await db.getState();
      const asset = state.candidates.find((x) => x.mint === parsed.data);
      const { onchain } = getProviders();
      const on = await onchain.getTokenRiskInputs(parsed.data);
      const risk = asset ? assessTokenRisk(asset, on) : null;
      if (c === "risk") return apiOk({ risk, provider: onchain.name, isDemo: onchain.isDemo }, rid);
      if (c === "signals") {
        const all = await generateSmartMoneySignals(db);
        return apiOk({ signals: all.filter((s) => s.asset === parsed.data) }, rid);
      }
      return apiOk(
        {
          asset: asset ?? null,
          risk,
          score: state.scores.find((s) => s.mint === parsed.data) ?? null,
        },
        rid,
      );
    }

    if (req.method === "POST") {
      const denied = mutatingRequestDenied(req);
      if (denied) {
        return apiError(denied.error, denied.code, denied.code === "UNAUTHORIZED" || denied.code === "AUTH_REQUIRED" ? 401 : 403, rid);
      }
    }

    if (a === "backtests" && req.method === "POST") {
      if (!entitlements.strategyLab) {
        return apiError("Strategy lab requires PRO entitlement", "ENTITLEMENT_DENIED", 402, rid);
      }
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const mint = typeof body.mint === "string" ? body.mint : undefined;
      const parsedCfg = body.config
        ? StrategyLabConfigSchema.partial().safeParse(body.config)
        : { success: true as const, data: {} };
      if (!parsedCfg.success) return apiError("Invalid strategy config", "INVALID_CONFIG", 400, rid);
      getAnalytics().track("backtest_started");
      const result = await runStrategyLab({ mint, config: parsedCfg.data, walkForward: true, db });
      getAnalytics().track("backtest_completed", { id: result.id });
      return apiOk({ backtest: result }, rid);
    }

    if (a === "alerts" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const parsed = z
        .object({
          name: z.string().min(1).max(80),
          trigger: z.enum([
            "SENTINEL_SCORE_CROSS",
            "TRACKED_WALLET_BUY",
            "TRACKED_WALLET_SELL",
            "MULTI_WALLET_ACCUMULATION",
            "LIQUIDITY_SPIKE",
            "HOLDER_CHANGE",
            "TOKEN_RISK_DOWNGRADE",
            "TOKEN_RISK_IMPROVEMENT",
            "PRICE_BREAKOUT",
            "VOLUME_ACCELERATION",
            "PORTFOLIO_DRAWDOWN",
            "PAPER_ENTRY",
            "PAPER_EXIT",
          ]),
          threshold: z.number().nullable().optional(),
        })
        .safeParse(body);
      if (!parsed.success) return apiError("Invalid alert rule", "INVALID_ALERT", 400, rid);
      const rule = createAlertRule(parsed.data);
      getAnalytics().track("alert_created", { id: rule.id });
      return apiOk({ rule }, rid);
    }

    if (a === "evaluate" && b) {
      const parsed = SolanaAddressSchema.safeParse(b);
      if (!parsed.success) return apiError("Invalid mint", "INVALID_ADDRESS", 400, rid);
      const proposal = await evaluateMint(parsed.data, db);
      return apiOk({ proposal, operatingMode: getOperatingMode() }, rid);
    }

    return apiError(`Unknown resource /${path.join("/")}`, "NOT_FOUND", 404, rid);
  } catch (err) {
    return apiError(err instanceof Error ? err.message : String(err), "INTERNAL", 500, rid);
  }
}

