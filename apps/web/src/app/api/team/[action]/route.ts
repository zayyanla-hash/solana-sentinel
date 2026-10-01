import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getTeamStore, getDatabase, PostgresDeliveryStore, PostgresIngestionStore } from "@sat/database";
import { TelegramClient } from "@sat/alerts";
import { ReadOnlyRpcReader } from "@sat/solana";
import { SolanaAddressSchema } from "@sat/shared";
import { authenticateTeamRequest, teamMember, teamMode, teamOriginAllowed, sessionToken } from "@/lib/request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const actionOf = (req: Request) => new URL(req.url).pathname.split("/").at(-1);
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
function cookie(token: string, expired = false): string {
  const secure = process.env.SAT_PUBLIC_ORIGIN?.startsWith("https://") ? "; Secure" : "";
  return `sentinel_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${expired ? 0 : 43200}${secure}`;
}
async function body(req: Request): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) throw new Error("INVALID_REQUEST");
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength;
    if (size > 16384) { await reader.cancel(); throw new Error("REQUEST_TOO_LARGE"); }
    chunks.push(part.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
const uuid = z.string().uuid();
export async function GET(req: Request) {
  if (!teamMode()) return json({ error: "Team mode is disabled" }, 404);
  try {
    await authenticateTeamRequest(req);
    const member = teamMember(req);
    if (!member) return json({ error: "Sign in required" }, 401);
    const team = getTeamStore(), delivery = new PostgresDeliveryStore(process.env.DATABASE_URL!);
    try {
      if (actionOf(req) === "activity") {
        const wallet = SolanaAddressSchema.parse(new URL(req.url).searchParams.get("wallet"));
        const journal = new PostgresIngestionStore(process.env.DATABASE_URL!);
        try { return json({ wallet, activity: await journal.getActivity(wallet), scope: "Most recent 50 observations; unsupported activity stays unclassified." }); }
        finally { await journal.close(); }
      }
      if (actionOf(req) !== "status") return json({ error: "Not found" }, 404);
      return json({ member, members: await team.listMembers(), rpcConfigured: Boolean(await team.getSecret("rpc") || process.env.SOLANA_RPC_URL),
        telegramConfigured: Boolean(await team.getSecret("telegram") || process.env.SAT_TELEGRAM_BOT_TOKEN),
        destination: await delivery.getDestination(member.id), deliveries: await delivery.listDeliveries(member.id), audit: await team.auditHistory() });
    } finally { await delivery.close(); }
  } catch { return json({ error: "Team storage unavailable. Check service status." }, 503); }
}
export async function POST(req: Request) {
  if (!teamMode()) return json({ error: "Team mode is disabled" }, 404);
  if (!teamOriginAllowed(req)) return json({ error: "Request origin is not allowed" }, 403);
  const action = actionOf(req);
  let actor: string | undefined;
  try {
    const team = getTeamStore();
    if (action === "login") {
      const input = z.object({ username: z.string().min(2).max(40), credential: z.string().min(1).max(256) }).parse(await body(req));
      const result = await team.login(input.username.toLowerCase().trim(), input.credential);
      if (!result) return json({ error: "Credentials not accepted" }, 401);
      const response = json({ member: result.member }); response.headers.set("Set-Cookie", cookie(result.token)); return response;
    }
    await authenticateTeamRequest(req);
    const member = teamMember(req);
    if (!member) return json({ error: "Sign in required" }, 401);
    actor = member.id;
    if (action === "logout") {
      await team.logout(sessionToken(req)!); const response = json({ ok: true }); response.headers.set("Set-Cookie", cookie("", true)); return response;
    }
    const raw = await body(req);
    // Record intent before shared changes. A missing completion is visibly incomplete.
    await team.audit(member.id, action ?? "unknown", null, "requested");
    let result: unknown = { ok: true };
    if (action === "rpc") {
      const input = z.object({ endpoint: z.string().url().max(2048), wallet: SolanaAddressSchema }).parse(raw);
      const url = new URL(input.endpoint);
      if (url.protocol !== "https:" || url.hostname === "api.mainnet-beta.solana.com" || url.username || url.password || url.hash) throw new Error("DEDICATED_HTTPS_RPC_REQUIRED");
      const reader = new ReadOnlyRpcReader(input.endpoint, { timeoutMs: 10000, maxRetries: 1 });
      const signal = AbortSignal.timeout(30000); const start = Date.now();
      await reader.verifyMainnet(signal);
      const signatures = await reader.signatures(input.wallet, null, 5, signal);
      if (!signatures.length) throw new Error("RPC_PROBE_NEEDS_ACTIVE_WALLET");
      await reader.transaction(signatures[0]!.signature, signal);
      await team.setSecret("rpc", input.endpoint);
      result = { ok: true, probeDurationMs: Date.now() - start, scope: "Mainnet identity and required read methods verified; sustained capacity is shown by monitor health." };
    } else if (action === "telegram") {
      const input = z.object({ token: z.string().max(256) }).parse(raw);
      await new TelegramClient(input.token).verifyBot();
      await team.setSecret("telegram", input.token);
    } else if (action === "member") {
      const input = z.object({ username: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/) }).parse(raw);
      const credential = randomBytes(24).toString("base64url");
      result = { member: await team.provision(input.username, credential), credential };
    } else if (action === "revoke") {
      const input = z.object({ id: uuid }).parse(raw);
      if (input.id === member.id) throw new Error("CANNOT_REVOKE_CURRENT_MEMBER");
      await team.revoke(input.id);
      const delivery = new PostgresDeliveryStore(process.env.DATABASE_URL!);
      try { await delivery.setDestinationEnabled(input.id, false); } finally { await delivery.close(); }
    } else if (action === "rule") {
      const input = z.object({ id: uuid, patch: z.object({ name: z.string().min(1).max(80).optional(), enabled: z.boolean().optional(),
        wallet: SolanaAddressSchema.nullable().optional(), mint: SolanaAddressSchema.nullable().optional(), cooldownMinutes: z.number().int().min(0).max(10080).optional() }).strict() }).parse(raw);
      await getDatabase().updateAlertRule(input.id, input.patch);
    } else if (action === "delete-rule") {
      await getDatabase().deleteAlertRule(z.object({ id: uuid }).parse(raw).id);
    } else {
      const delivery = new PostgresDeliveryStore(process.env.DATABASE_URL!);
      try {
        if (action === "destination") {
          const input = z.object({ chatId: z.string().regex(/^-?[0-9]{1,20}$/) }).parse(raw);
          const token = await team.getSecret("telegram") || process.env.SAT_TELEGRAM_BOT_TOKEN;
          if (!token) throw new Error("TELEGRAM_NOT_CONFIGURED");
          const challenge = await delivery.beginDestinationVerification(member.id, input.chatId);
          const sent = await new TelegramClient(token).sendVerificationChallenge(input.chatId, challenge.challenge);
          if (sent.kind !== "sent") { await delivery.cancelDestinationVerification(member.id); throw new Error("TELEGRAM_VERIFICATION_SEND_FAILED"); }
        } else if (action === "verify-destination") {
          result = await delivery.verifyDestination(member.id, z.object({ code: z.string().min(1).max(32) }).parse(raw).code);
        } else if (action === "destination-enabled") {
          await delivery.setDestinationEnabled(member.id, z.object({ enabled: z.boolean() }).parse(raw).enabled);
        } else if (action === "retry-delivery") {
          if (!await delivery.manualRetry(z.object({ id: uuid }).parse(raw).id, member.id)) return json({ error: "Delivery not found or not retryable" }, 404);
        } else if (action === "test-destination") {
          const destination = await delivery.getDestination(member.id);
          const token = await team.getSecret("telegram") || process.env.SAT_TELEGRAM_BOT_TOKEN;
          if (!destination?.verified || !destination.chatId || !token) throw new Error("VERIFIED_DESTINATION_REQUIRED");
          await delivery.authorizeTest(member.id);
          const sent = await new TelegramClient(token).sendText(destination.chatId, "Solana Sentinel connection test. This is not a trade alert.");
          if (sent.kind !== "sent") throw new Error("TELEGRAM_TEST_FAILED");
        } else return json({ error: "Not found" }, 404);
      } finally { await delivery.close(); }
    }
    await team.audit(member.id, action!, null, "completed"); return json(result);
  } catch (e) {
    if (actor) await getTeamStore().audit(actor, action ?? "unknown", null, "failed").catch(() => {});
    const code = e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : "REQUEST_FAILED";
    return json({ error: code === "REQUEST_FAILED" ? "Request failed. Check the fields and service connections." : code.replaceAll("_", " "), code }, code === "LOGIN_RATE_LIMITED" ? 429 : 400);
  }
}
