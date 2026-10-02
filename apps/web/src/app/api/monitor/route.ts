import { serviceHealth } from "@/lib/service-health";
import { authenticateTeamRequest, teamMode } from "@/lib/request-guard";
import { NextResponse } from "next/server";
import { PostgresIngestionStore, getDatabase } from "@sat/database";
import { productionAuthDenied } from "@/lib/request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await authenticateTeamRequest(req);
  const denied = productionAuthDenied(req, true);
  if (denied) return NextResponse.json({ error: denied.error, code: denied.code }, { status: denied.status });
  const services = await serviceHealth();
  const observedAt = new Date().toISOString();
  const scope = "address-accountKeys; bounded bootstrap history";
  if (!process.env.DATABASE_URL || process.env.SAT_WALLET_HISTORY_SOURCE !== "journal") {
    return NextResponse.json({ status: "NOT_CONFIGURED", scope, stats: null, wallets: [], observedAt, ...services });
  }
  const store = new PostgresIngestionStore(process.env.DATABASE_URL);
  try {
    const [stats, checkpoints] = await Promise.all([store.getStats(), store.getCheckpoints()]);
    const now = Date.parse(observedAt);
    // Match the journal history provider and score freshness gate.
    const maxAge = 120_000;
    const configured = process.env.SENTINEL_MONITOR_WALLETS?.split(",").map((w) => w.trim()).filter(Boolean);
    const active = new Set(configured?.length ? configured : (await getDatabase().getState()).watchlist.filter((w) => w.kind === "WALLET").map((w) => w.address));
    const wallets = checkpoints.filter(({ wallet }) => active.has(wallet)).map(({ wallet, checkpoint }) => ({
      wallet, coverage: checkpoint.coverage, lastSuccessAt: checkpoint.lastSuccessAt,
      lastError: checkpoint.lastError,
      pollAgeMs: checkpoint.lastSuccessAt ? now - Date.parse(checkpoint.lastSuccessAt) : null,
    }));
    const healthy = (!teamMode() || (services.worker.status === "healthy" && services.storage.status === "OK")) && stats.pendingAlerts === 0 && wallets.length === active.size && wallets.length > 0 && wallets.every((w) => w.coverage === "CURRENT" &&
      !w.lastError && w.pollAgeMs !== null && w.pollAgeMs >= 0 && w.pollAgeMs <= maxAge);
    return NextResponse.json({ status: active.size === 0 ? "WAITING_FOR_WALLETS" : healthy ? "HEALTHY" : "DEGRADED", scope, stats, wallets, observedAt, ...services });
  } catch {
    return NextResponse.json({ status: "DEGRADED", scope, stats: null, wallets: [], observedAt, ...services,
      error: "Monitor storage unavailable", code: "MONITOR_STORAGE_UNAVAILABLE" }, { status: 503 });
  } finally {
    await store.close();
  }
}
