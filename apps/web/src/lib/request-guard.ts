/**
 * Proportionate CSRF / origin check for mutating POST /api/state.
 * Loopback clients without Origin (curl) are allowed when Host is loopback.
 * Non-loopback bind requires SAT_API_TOKEN (Bearer) in addition to Origin allow-list.
 */

import { z } from "zod";
import { getTeamStore, type TeamMember } from "@sat/database";

export const teamMode = () => process.env.SENTINEL_TEAM_MODE === "true";
const authenticatedRequests = new WeakMap<Request, TeamMember>();
export const teamMember = (req: Request) => authenticatedRequests.get(req);
export function sessionToken(req: Request): string | null {
  return req.headers.get("cookie")?.split(";").map((v) => v.trim()).find((v) => v.startsWith("sentinel_session="))?.slice(17) ?? null;
}
export async function authenticateTeamRequest(req: Request): Promise<void> {
  if (!teamMode()) return;
  const member = await getTeamStore().authenticate(sessionToken(req));
  if (member) authenticatedRequests.set(req, member);
}
export function teamOriginAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  const configured = process.env.SAT_PUBLIC_ORIGIN;
  return Boolean(origin && configured && origin === configured);
}

import { SolanaAddressSchema, isPublicDemo } from "@sat/shared";
import { parseApiKeys, resolveApiPrincipal } from "@sat/entitlements";

function loopbackHost(host: string): boolean {
  const h = host.split(":")[0]?.toLowerCase() ?? "";
  return h === "127.0.0.1" || h === "localhost" || h === "[::1]" || h === "::1";
}

export function bindHost(): string {
  return (process.env.SAT_BIND_HOST ?? "127.0.0.1").trim() || "127.0.0.1";
}

export function bindRequiresAuth(): boolean {
  return !loopbackHost(bindHost());
}

export const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("discover") }),
  z.object({ action: z.literal("research_pass") }),
  z.object({ action: z.literal("bootstrap") }),
  z.object({ action: z.literal("evaluate"), mint: SolanaAddressSchema }),
  z.object({ action: z.literal("paper_execute"), proposalId: z.string().uuid() }),
  z.object({ action: z.literal("experiment") }),
  z.object({ action: z.literal("reset") }),
  z.object({ action: z.literal("mark") }),
  z.object({
    action: z.literal("backtest"),
    mint: SolanaAddressSchema.optional(),
    walkForward: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("alert_create"),
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
  }),
  z.object({ action: z.literal("wallet_analyze"), address: SolanaAddressSchema }),
  z.object({
    action: z.literal("watchlist_add"),
    kind: z.enum(["MINT", "WALLET"]),
    address: SolanaAddressSchema,
  }),
  z.object({ action: z.literal("watchlist_remove"), id: z.string().uuid() }),
]);

export type ApiAction = z.infer<typeof ActionSchema>;

const PAPER_RESEARCH_ACTIONS = new Set<ApiAction["action"]>([
  "bootstrap", "experiment", "reset", "research_pass", "discover", "evaluate",
  "paper_execute", "backtest", "mark",
]);

export function isMonitorOnly(): boolean {
  return process.env.SENTINEL_MONITOR_ONLY === "true" ||
    (process.env.NODE_ENV === "production" && process.env.SENTINEL_ENABLE_PAPER_RESEARCH !== "true");
}

export function paperResearchDenied(action?: ApiAction["action"]): { error: string; code: string } | null {
  if (!action || !PAPER_RESEARCH_ACTIONS.has(action)) return null;
  if (isMonitorOnly()) {
    return { error: "This deployment is in monitor-only mode", code: "MONITOR_ONLY" };
  }
  if (action === "bootstrap" && process.env.NODE_ENV === "production" && process.env.DEMO_MODE !== "true") {
    return { error: "Demo bootstrap requires DEMO_MODE=true", code: "DEMO_MODE_REQUIRED" };
  }
  return null;
}

export function allowedOrigins(): string[] {
  const extra = (process.env.SAT_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const port = process.env.SAT_BIND_PORT ?? process.env.PORT ?? "4317";
  return [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    "http://127.0.0.1:4317",
    "http://localhost:4317",
    ...extra,
  ];
}

export function originAllowed(origin: string | null, host: string): boolean {
  if (origin) {
    if (allowedOrigins().includes(origin)) return true;
    try {
      const u = new URL(origin);
      return loopbackHost(u.host);
    } catch {
      return false;
    }
  }
  return loopbackHost(host);
}

export function operatorAuthorized(req: Request): boolean {
  if (teamMode()) return authenticatedRequests.has(req);
  const token = process.env.SAT_API_TOKEN?.trim();
  return Boolean(token) && req.headers.get("authorization") === `Bearer ${token}`;
}

export function productionAuthDenied(req: Request, operatorOnly = false): { error: string; code: string; status: number } | null {
  if (teamMode()) {
    if (authenticatedRequests.has(req)) return null;
    if (!operatorOnly && resolveApiPrincipal(req.headers.get("authorization"))) return null;
    return { error: "Sign in with your team account", code: "UNAUTHORIZED", status: 401 };
  }
  if (process.env.NODE_ENV !== "production") return null;
  if (!process.env.SAT_API_TOKEN?.trim() && (operatorOnly || parseApiKeys().length === 0)) {
    return { error: "Production API credentials are not configured", code: "AUTH_UNAVAILABLE", status: 503 };
  }
  if (!operatorAuthorized(req) && (operatorOnly || !resolveApiPrincipal(req.headers.get("authorization")))) {
    return { error: "API credential required", code: "UNAUTHORIZED", status: 401 };
  }
  return null;
}

export function mutatingRequestDenied(req: Request, action?: ApiAction["action"], scope: "operator" | "api" = "operator"): { error: string; code: string } | null {
  const productionDenied = productionAuthDenied(req, scope === "operator");
  if (productionDenied) return productionDenied;
  const researchDenied = paperResearchDenied(action);
  if (researchDenied) return researchDenied;
  const localBootstrap = action === "bootstrap" && process.env.NODE_ENV !== "production" &&
    !bindRequiresAuth() && originAllowed(req.headers.get("origin"), req.headers.get("host") ?? "");
  if (isPublicDemo() && !operatorAuthorized(req) && !localBootstrap) {
    return {
      error: "Public demo is read-only. Authenticated operator token required to mutate.",
      code: "PUBLIC_DEMO_READONLY",
    };
  }
  if (teamMode()) {
    return teamOriginAllowed(req) ? null : { error: "Cross-origin mutation blocked", code: "CSRF_BLOCKED" };
  }
  if (bindRequiresAuth()) {
    if (!process.env.SAT_API_TOKEN?.trim() && (scope === "operator" || parseApiKeys().length === 0)) {
      return {
        error: "API credential required when SAT_BIND_HOST is not loopback",
        code: "AUTH_REQUIRED",
      };
    }
    if (!operatorAuthorized(req) && (scope === "operator" || !resolveApiPrincipal(req.headers.get("authorization")))) {
      return { error: "Unauthorized", code: "UNAUTHORIZED" };
    }
  }
  const host = req.headers.get("host") ?? "";
  const origin = req.headers.get("origin");
  if (originAllowed(origin, host)) return null;
  return { error: "Cross-origin mutation blocked", code: "CSRF_BLOCKED" };
}
