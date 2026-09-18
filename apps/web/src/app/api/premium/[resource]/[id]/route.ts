import { NextResponse } from "next/server";
import {
  x402Enabled,
  paymentRequired,
  verifyPaymentSignature,
  PREMIUM_RESOURCES,
} from "@sat/x402";
import { handleV1 } from "@/lib/api-v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Isolated x402 V2 premium surface. Disabled unless X402_ENABLED=true.
 * Never invents payment success. Devnet only.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ resource: string; id: string }> },
) {
  const { resource, id } = await ctx.params;
  const map: Record<string, string> = {
    "token-risk": PREMIUM_RESOURCES.tokenRisk,
    "wallet-score": PREMIUM_RESOURCES.walletScore,
    signal: PREMIUM_RESOURCES.signal,
    "deep-analysis": PREMIUM_RESOURCES.deepAnalysis,
  };
  const key = map[resource];
  if (!key) {
    return NextResponse.json({ error: "Unknown premium resource", code: "NOT_FOUND" }, { status: 404 });
  }

  if (!x402Enabled()) {
    return NextResponse.json(
      {
        error: "x402 is feature-flagged off. Set X402_ENABLED=true and X402_PAY_TO for the PoC.",
        code: "X402_DISABLED",
        resource: key,
      },
      { status: 503 },
    );
  }

  const sig = req.headers.get("payment-signature") ?? req.headers.get("PAYMENT-SIGNATURE");
  const verified = await verifyPaymentSignature(sig, key);
  if (!verified.valid) {
    const pay = paymentRequired(key, `Sentinel premium ${key}`);
    return NextResponse.json(
      { ...pay.body, verify: verified.reason },
      { status: 402, headers: pay.headers },
    );
  }

  if (resource === "token-risk") return handleV1(req, ["token", id, "risk"]);
  if (resource === "wallet-score") return handleV1(req, ["wallet", id, "score"]);
  if (resource === "signal") return handleV1(req, ["signals"]);
  return handleV1(req, ["token", id]);
}
