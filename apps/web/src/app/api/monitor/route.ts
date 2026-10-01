import { NextResponse } from "next/server";
import { PostgresIngestionStore } from "@sat/database";
import { productionAuthDenied } from "@/lib/request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = productionAuthDenied(req, true);
  if (denied) return NextResponse.json({ error: denied.error, code: denied.code }, { status: denied.status });
  const observedAt = new Date().toISOString();
  const scope = "address-accountKeys; bounded bootstrap history";
  if (!process.env.DATABASE_URL || process.env.SAT_WALLET_HISTORY_SOURCE !== "journal") {
    return NextResponse.json({ status: "NOT_CONFIGURED", scope, stats: null, wallets: [], observedAt });
  }
  const store = new PostgresIngestionStore(process.env.DATABASE_URL);
  try {
    const [stats, checkpoints] = await Promise.all([store.getStats(), store.getCheckpoints()]);
    const now = Date.parse(observedAt);
    // Match the journal history provider and score freshness gate.
    const maxAge = 120_000;
    const wallets = checkpoints.map(({ wallet, checkpoint }) => ({
      wallet, coverage: checkpoint.coverage, lastSuccessAt: checkpoint.lastSuccessAt,
      lastError: checkpoint.lastError,
      pollAgeMs: checkpoint.lastSuccessAt ? now - Date.parse(checkpoint.lastSuccessAt) : null,
    }));
    const healthy = stats.pendingAlerts === 0 && wallets.length > 0 && wallets.every((w) => w.coverage === "CURRENT" &&
      !w.lastError && w.pollAgeMs !== null && w.pollAgeMs >= 0 && w.pollAgeMs <= maxAge);
    return NextResponse.json({ status: healthy ? "HEALTHY" : "DEGRADED", scope, stats, wallets, observedAt });
  } catch {
    return NextResponse.json({ status: "DEGRADED", scope, stats: null, wallets: [], observedAt,
      error: "Monitor storage unavailable", code: "MONITOR_STORAGE_UNAVAILABLE" }, { status: 503 });
  } finally {
    await store.close();
  }
}
