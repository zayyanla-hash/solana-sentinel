/**
 * Jupiter Tokens API — verification / organic score.
 * Fail-closed: missing key or malformed payload → null, never a fake "verified".
 * Docs: https://dev.jup.ag (Tokens API). Organic score is advisory, not a safety rating.
 */

export interface JupiterTokenIntel {
  verified: boolean | null;
  organicScore: number | null;
  source: string;
  isDemo: boolean;
}

export const EMPTY_JUPITER_INTEL: JupiterTokenIntel = {
  verified: null,
  organicScore: null,
  source: "unavailable",
  isDemo: false,
};

export async function fetchJupiterTokenIntel(mint: string): Promise<JupiterTokenIntel> {
  const key = process.env.JUPITER_API_KEY?.trim();
  if (!key) {
    return { ...EMPTY_JUPITER_INTEL, source: "jupiter-tokens skipped (no API key)" };
  }
  const base = (process.env.JUPITER_TOKENS_API_BASE ?? "https://api.jup.ag/tokens/v2").replace(/\/$/, "");
  const url = `${base}/search?query=${encodeURIComponent(mint)}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (key) headers["x-api-key"] = key;
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return { ...EMPTY_JUPITER_INTEL, source: `jupiter-tokens HTTP ${res.status}` };
    const json = (await res.json()) as unknown;
    const rows = Array.isArray(json) ? json : (json as { data?: unknown[] }).data;
    if (!Array.isArray(rows) || !rows.length) {
      return { ...EMPTY_JUPITER_INTEL, source: "jupiter-tokens empty" };
    }
    const hit =
      rows.find((r) => r && typeof r === "object" && (r as { id?: string }).id === mint) ?? rows[0];
    if (!hit || typeof hit !== "object") return { ...EMPTY_JUPITER_INTEL, source: "jupiter-tokens unparsed" };
    const rec = hit as {
      organicScore?: unknown;
      isVerified?: unknown;
      verified?: unknown;
      tags?: unknown;
    };
    const tags = Array.isArray(rec.tags) ? rec.tags.map(String) : [];
    let verified: boolean | null = null;
    if (typeof rec.isVerified === "boolean") verified = rec.isVerified;
    else if (typeof rec.verified === "boolean") verified = rec.verified;
    else if (tags.includes("verified")) verified = true;
    const organicRaw = Number(rec.organicScore);
    const organicScore = Number.isFinite(organicRaw) ? Math.max(0, Math.min(100, organicRaw)) : null;
    return {
      verified,
      organicScore,
      source: "jupiter-tokens-v2",
      isDemo: false,
    };
  } catch (err) {
    return {
      ...EMPTY_JUPITER_INTEL,
      source: `jupiter-tokens error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
