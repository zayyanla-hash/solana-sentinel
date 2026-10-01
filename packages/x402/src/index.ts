import { createHash, randomBytes } from "node:crypto";

/**
 * Isolated x402 V2 proof-of-concept.
 * Official: https://docs.x402.org/getting-started/quickstart-for-sellers
 *
 * Feature-flagged. Devnet/sandbox first. Never invents payment success.
 * Does not move mainnet funds. Local development works with X402_ENABLED=false.
 */

export const X402_VERSION = 2 as const;
export const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

export interface X402Accepts {
  scheme: "exact";
  price: string;
  network: string;
  payTo: string;
}

export interface X402ResourceConfig {
  accepts: X402Accepts[];
  description: string;
  mimeType: string;
}

export interface PaymentRequiredBody {
  x402Version: 2;
  accepts: X402Accepts[];
  error: string;
  resource: string;
}

export function x402Enabled(): boolean {
  const v = (process.env.X402_ENABLED ?? "").trim().toLowerCase();
  return v === "true" || v === "1";
}

export function x402Network(): string {
  const n = (process.env.X402_NETWORK ?? "devnet").trim().toLowerCase();
  if (n === "mainnet") {
    throw new Error("X402 mainnet is disabled in this build — set X402_NETWORK=devnet");
  }
  return SOLANA_DEVNET;
}

export function x402PayTo(): string | null {
  const v = process.env.X402_PAY_TO?.trim();
  return v ? v : null;
}

export function priceFor(resource: string): string {
  const catalog: Record<string, string> = {
    "token-risk": process.env.X402_PRICE_TOKEN_RISK ?? "$0.005",
    "wallet-score": process.env.X402_PRICE_WALLET_SCORE ?? "$0.005",
    signal: process.env.X402_PRICE_SIGNAL ?? "$0.001",
    "deep-analysis": process.env.X402_PRICE_DEEP_ANALYSIS ?? "$0.01",
  };
  return catalog[resource] ?? process.env.X402_PRICE_DEFAULT ?? "$0.005";
}

export function paymentRequired(resource: string, _description: string): {
  status: 402;
  headers: Record<string, string>;
  body: PaymentRequiredBody;
} {
  const payTo = x402PayTo();
  const accepts: X402Accepts[] = payTo
    ? [{ scheme: "exact", price: priceFor(resource), network: x402Network(), payTo }]
    : [];
  const body: PaymentRequiredBody = {
    x402Version: X402_VERSION,
    accepts,
    error: payTo ? "PAYMENT_REQUIRED" : "X402_PAY_TO unset — refusing to advertise a payee",
    resource,
  };
  const encoded = Buffer.from(JSON.stringify(body), "utf8").toString("base64");
  return {
    status: 402,
    headers: {
      "PAYMENT-REQUIRED": encoded,
      "Cache-Control": "no-store",
    },
    body,
  };
}

const spentNonces = new Map<string, number>();

export function replaySeen(nonce: string): boolean {
  const now = Date.now();
  for (const [k, exp] of spentNonces) {
    if (exp < now) spentNonces.delete(k);
  }
  return spentNonces.has(nonce);
}

export function rememberNonce(nonce: string, ttlMs = 10 * 60_000): void {
  spentNonces.set(nonce, Date.now() + ttlMs);
}

export interface FacilitatorVerifyResult {
  valid: boolean;
  reason: string;
  settlement?: { tx: string; network: string };
}

/**
 * Verify PAYMENT-SIGNATURE via facilitator. Never returns valid=true without facilitator confirmation.
 */
export async function verifyPaymentSignature(
  signatureHeader: string | null,
  resource: string,
): Promise<FacilitatorVerifyResult> {
  if (!x402Enabled()) {
    return { valid: false, reason: "X402_ENABLED is false" };
  }
  if (!signatureHeader) {
    return { valid: false, reason: "missing PAYMENT-SIGNATURE" };
  }
  let parsed: { nonce?: string; network?: string };
  try {
    parsed = JSON.parse(Buffer.from(signatureHeader, "base64").toString("utf8")) as {
      nonce?: string;
      network?: string;
    };
  } catch {
    return { valid: false, reason: "malformed PAYMENT-SIGNATURE" };
  }
  if (!parsed.nonce) return { valid: false, reason: "missing nonce" };
  if (replaySeen(parsed.nonce)) return { valid: false, reason: "replay" };
  if (parsed.network === SOLANA_MAINNET) {
    return { valid: false, reason: "mainnet payments are disabled" };
  }
  const facilitator = process.env.X402_FACILITATOR_URL?.trim() ?? "https://x402.org/facilitator";
  try {
    const res = await fetch(`${facilitator.replace(/\/$/, "")}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        x402Version: X402_VERSION,
        paymentHeader: signatureHeader,
        resource,
      }),
    });
    if (!res.ok) return { valid: false, reason: `facilitator HTTP ${res.status}` };
    const json = (await res.json()) as { isValid?: boolean; invalidReason?: string; tx?: string };
    if (json.isValid === true) {
      rememberNonce(parsed.nonce);
      return {
        valid: true,
        reason: "facilitator",
        settlement: json.tx ? { tx: json.tx, network: parsed.network ?? x402Network() } : undefined,
      };
    }
    return { valid: false, reason: json.invalidReason ?? "facilitator rejected" };
  } catch (err) {
    return {
      valid: false,
      reason: `facilitator unreachable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function idempotencyKey(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export function newNonce(): string {
  return randomBytes(16).toString("hex");
}

export const PREMIUM_RESOURCES = {
  tokenRisk: "token-risk",
  walletScore: "wallet-score",
  signal: "signal",
  deepAnalysis: "deep-analysis",
} as const;
