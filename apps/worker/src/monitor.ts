import { mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { SolanaAddressSchema } from "@sat/shared";
import { getDatabase, closeDatabase, PostgresIngestionStore } from "@sat/database";
import { ReadOnlyRpcReader, PollingMonitor, persistMonitorScore, dispatchPendingTradeAlerts } from "@sat/pipeline";

function boundedEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`invalid-${name}`);
  return n;
}
function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); }
    signal.addEventListener("abort", done, { once: true });
  });
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("monitor-database-required");
  const endpoint = process.env.SOLANA_RPC_URL?.trim();
  if (!endpoint) throw new Error("monitor-rpc-required");
  const db = getDatabase();
  const configured = process.env.SENTINEL_MONITOR_WALLETS?.split(",").map((w) => w.trim()).filter(Boolean);
  const wallets = [...new Set(configured?.length ? configured : (await db.getState()).watchlist.filter((w) => w.kind === "WALLET").map((w) => w.address))];
  if (!wallets.length || wallets.length > 50) throw new Error("monitor-requires-1-to-50-wallets");
  wallets.forEach((w) => SolanaAddressSchema.parse(w));
  const intervalMs = boundedEnv("SENTINEL_MONITOR_INTERVAL_MS", 30_000, 1000, 3_600_000);
  const pageSize = boundedEnv("SENTINEL_MONITOR_PAGE_SIZE", 10, 1, 100);
  const maxPagesPerCycle = boundedEnv("SENTINEL_MONITOR_MAX_PAGES", 2, 1, 100);
  const once = process.argv.includes("--once");
  const durationArg = process.argv.find((a) => a.startsWith("--duration-ms="));
  const duration = durationArg ? Number(durationArg.split("=")[1]) : null;
  if (duration != null && (!Number.isSafeInteger(duration) || duration < 1 || duration > 604_800_000)) throw new Error("invalid-monitor-duration");
  const controller = new AbortController();
  const stop = (signal: "SIGINT" | "SIGTERM") => { process.exitCode = signal === "SIGINT" ? 130 : 143; controller.abort(); };
  const onInt = () => stop("SIGINT"), onTerm = () => stop("SIGTERM");
  process.once("SIGINT", onInt); process.once("SIGTERM", onTerm);
  const deadline = duration == null ? null : setTimeout(() => controller.abort(), duration);
  const store = new PostgresIngestionStore(url);
  const monitor = new PollingMonitor(new ReadOnlyRpcReader(endpoint), store, { pageSize, maxPagesPerCycle });
  const healthPath = process.env.SENTINEL_MONITOR_HEALTH_FILE?.trim();
  const startedAt = new Date().toISOString();
  let cycles = 0, failedPolls = 0, inserted = 0, duplicates = 0, alertsProcessed = 0, alertEvents = 0;
  try {
    console.log(JSON.stringify({ service: "sentinel-monitor", startedAt, walletCount: wallets.length,
      commitment: "finalized", mode: "READ_ONLY", intervalMs, pageSize, maxPagesPerCycle }));
    do {
      const cycleStarted = performance.now();
      const results = [];
      for (const wallet of wallets) {
        if (controller.signal.aborted) break;
        const result = await monitor.pollWallet(wallet, controller.signal);
        inserted += result.inserted; duplicates += result.duplicates;
        if (!result.ok && !controller.signal.aborted) failedPolls++;
        if (!controller.signal.aborted) {
          await persistMonitorScore(wallet, result, store, db);
          const dispatched = await dispatchPendingTradeAlerts(wallet, store, db);
          alertsProcessed += dispatched.processed;
          alertEvents += dispatched.events;
        }
        results.push(result);
      }
      cycles++;
      const stats = await store.getStats();
      const metric = { service: "sentinel-monitor", at: new Date().toISOString(), startedAt, cycles,
        status: stats.pendingAlerts === 0 && results.length === wallets.length && results.every((r) => {
          const age = r.checkpoint?.lastSuccessAt ? Date.now() - Date.parse(r.checkpoint.lastSuccessAt) : Infinity;
          return r.ok && r.coverage === "CURRENT" && age >= 0 && age <= 120_000;
        }) ? "healthy" : "degraded",
        pollDurationMs: Math.round(performance.now() - cycleStarted), rssBytes: process.memoryUsage().rss,
        inserted, duplicates, failedPolls, alertsProcessed, alertEvents, stats, wallets: results.map((r) => ({ wallet: r.wallet, ok: r.ok, coverage: r.coverage,
          reason: r.reason, lastSuccessAt: r.checkpoint?.lastSuccessAt ?? null,
          pollAgeMs: r.checkpoint?.lastSuccessAt ? Date.now() - Date.parse(r.checkpoint.lastSuccessAt) : null })) };
      console.log(JSON.stringify(metric));
      if (healthPath) {
        const absolute = path.resolve(healthPath);
        await mkdir(path.dirname(absolute), { recursive: true });
        await writeFile(`${absolute}.tmp`, JSON.stringify(metric, null, 2) + "\n", { mode: 0o600 });
        await rename(`${absolute}.tmp`, absolute);
      }
      if (once || controller.signal.aborted) break;
      await delay(intervalMs, controller.signal);
    } while (!controller.signal.aborted);
    if (once && failedPolls) process.exitCode = 1;
  } finally {
    if (deadline) clearTimeout(deadline);
    process.removeListener("SIGINT", onInt); process.removeListener("SIGTERM", onTerm);
    await store.close();
    await closeDatabase();
  }
}

main().catch(() => { console.error("sentinel-monitor-failed"); process.exitCode ??= 1; }).finally(closeDatabase);
