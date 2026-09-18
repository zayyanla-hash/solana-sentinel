/**
 * Proportionate CSRF / origin check for mutating POST /api/state.
 * Loopback clients without Origin (curl) are allowed when Host is loopback.
 * Non-loopback bind requires SAT_API_TOKEN (Bearer) in addition to Origin allow-list.
 */

import { z } from "zod";
import { SolanaAddressSchema, isPublicDemo } from "@sat/shared";

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
]);

export type ApiAction = z.infer<typeof ActionSchema>;

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
  const token = process.env.SAT_API_TOKEN?.trim();
  if (!token) return false;
  return req.headers.get("authorization") === `Bearer ${token}`;
}

export function mutatingRequestDenied(req: Request): { error: string; code: string } | null {
  if (isPublicDemo() && !operatorAuthorized(req)) {
    return {
      error: "Public demo is read-only. Authenticated operator token required to mutate.",
      code: "PUBLIC_DEMO_READONLY",
    };
  }
  if (bindRequiresAuth()) {
    const token = process.env.SAT_API_TOKEN?.trim();
    if (!token) {
      return {
        error: "SAT_API_TOKEN required when SAT_BIND_HOST is not loopback",
        code: "AUTH_REQUIRED",
      };
    }
    if (!operatorAuthorized(req)) {
      return { error: "Unauthorized", code: "UNAUTHORIZED" };
    }
  }
  const host = req.headers.get("host") ?? "";
  const origin = req.headers.get("origin");
  if (originAllowed(origin, host)) return null;
  return { error: "Cross-origin mutation blocked", code: "CSRF_BLOCKED" };
}
