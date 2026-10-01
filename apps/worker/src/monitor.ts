import { TelegramClient } from "@sat/alerts";
import { mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { SolanaAddressSchema } from "@sat/shared";
import { getDatabase, closeDatabase, PostgresIngestionStore, PostgresTeamStore, PostgresDeliveryStore, PostgresDatabase } from "@sat/database";
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
  const team = process.env.SENTINEL_TEAM_MODE === "true" ? new PostgresTeamStore(url) : null;
  if (team) await team.init();
  const delivery = team ? new PostgresDeliveryStore(url) : null;
  const db = getDatabase();
  await db.getState();
  const configured = process.env.SENTINEL_MONITOR_WALLETS?.split(",").map((w) => w.trim()).filter(Boolean);
  const walletSource = configured?.length ? "configured" : "shared-watchlist";
  const currentWallets = async (): Promise<string[]> => {
    const wallets = [...new Set(configured?.length ? configured
      : (await db.getState()).watchlist.filter((w) => w.kind === "WALLET").map((w) => w.address))];
    if (wallets.length > 50) throw new Error("monitor-wallet-capacity");
    wallets.forEach((w) => SolanaAddressSchema.parse(w));
    return wallets;
  };
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
  let endpoint: string | null = null;
  let monitor: PollingMonitor | null = null;
  const healthPath = process.env.SENTINEL_MONITOR_HEALTH_FILE?.trim();
  const startedAt = new Date().toISOString();
  let cycles = 0, failedPolls = 0, inserted = 0, duplicates = 0, alertsProcessed = 0, alertEvents = 0;
  try {
    console.log(JSON.stringify({ service: "sentinel-monitor", startedAt, walletSource,
      commitment: "finalized", mode: "READ_ONLY", intervalMs, pageSize, maxPagesPerCycle }));
    do {
      const cycleStarted = performance.now();
      const nextEndpoint = (await team?.getSecret("rpc")) || process.env.SOLANA_RPC_URL?.trim() || null;
      if (endpoint !== nextEndpoint) {
        endpoint = nextEndpoint;
        monitor = endpoint ? new PollingMonitor(new ReadOnlyRpcReader(endpoint), store, { pageSize, maxPagesPerCycle }) : null;
      }
      const wallets = await currentWallets();
      const pressure = await store.getStats();
      if (pressure.observationCapacityPercent >= 80) {
        for (let batch = 0; batch < 5; batch++) {
          if (await store.archiveObservations({ olderThan: new Date(Date.now() - 3600000), limit: 1000 }) < 1000) break;
        }
      }
      const results = [];
      let contended = 0;
      for (const wallet of monitor ? wallets : []) {
        if (controller.signal.aborted) break;
        const owned = await store.withWalletOwner(wallet, async () => {
          const result = await monitor!.pollWallet(wallet, controller.signal);
          inserted += result.inserted; duplicates += result.duplicates;
          if (!result.ok && !controller.signal.aborted) failedPolls++;
          if (!controller.signal.aborted) {
            await persistMonitorScore(wallet, result, store, db);
            const dispatched = await dispatchPendingTradeAlerts(wallet, store, db);
            alertsProcessed += dispatched.processed;
            alertEvents += dispatched.events;
          }
          return result;
        });
        if (owned.owned) results.push(owned.value);
        else contended++;
      }
      // Already committed work must drain even if its wallet was removed meanwhile.
      for (const { wallet } of await store.getCheckpoints()) {
        if (wallets.includes(wallet) || controller.signal.aborted) continue;
        await store.withWalletOwner(wallet, async () => { await dispatchPendingTradeAlerts(wallet, store, db); });
      }
      let telegram = null;
      if (delivery && team) {
        await delivery.reconcileFacts();
        const token = await team.getSecret("telegram") || process.env.SAT_TELEGRAM_BOT_TOKEN;
        if (token) {
          const client = new TelegramClient(token);
          // Claim one at a time so a batch cannot outlive its delivery leases.
          for (let i = 0; i < 20 && !controller.signal.aborted; i++) {
            const [item] = await delivery.claimDue(1);
            if (!item) break;
            await delivery.finishSend(item.id, item.leaseToken, await client.sendAlert(item.chatId, item.event));
          }
        }
        telegram = await delivery.getStats();
      }
      const alertFacts = db instanceof PostgresDatabase ? await db.getAlertFactStats() : null;
      if (db instanceof PostgresDatabase && alertFacts) {
        await db.archiveAlertFacts({ olderThan: new Date(Date.now() - (alertFacts.usagePercent >= 80 ? 3600000 : 30 * 86400000)), limit: 1000 });
      }
      cycles++;
      // Retain a recent hot window, shortening it if capacity is approaching its cap.
      // Each archive row preserves a compressed raw observation and replay key.
      const beforeArchive = await store.getStats();
      const retentionMs = beforeArchive.observationCapacityPercent >= 80 ? 3_600_000 : 7 * 86_400_000;
      const archived = await store.archiveObservations({ olderThan: new Date(Date.now() - retentionMs), limit: 100 });
      const stats = await store.getStats();
      const metric = { service: "sentinel-monitor", at: new Date().toISOString(), startedAt, cycles,
        telegram, alertFacts,
        status: !monitor ? "waiting-for-rpc" : wallets.length === 0 ? "waiting-for-wallets" : contended === wallets.length ? "standby" :
          (!telegram || !(telegram.pending || telegram.retrying || telegram.failed || telegram.uncertain)) && stats.pendingAlerts === 0 && contended === 0 && results.length === wallets.length && results.every((r) => {
          const age = r.checkpoint?.lastSuccessAt ? Date.now() - Date.parse(r.checkpoint.lastSuccessAt) : Infinity;
          return r.ok && r.coverage === "CURRENT" && age >= 0 && age <= 120_000;
        }) ? "healthy" : "degraded",
        pollDurationMs: Math.round(performance.now() - cycleStarted), rssBytes: process.memoryUsage().rss,
        walletSource, walletCount: wallets.length, contended, archived,
        capacityWarning: stats.observationCapacityPercent >= 80 || stats.outboxCapacityPercent >= 80 || (alertFacts?.usagePercent ?? 0) >= 80,
        inserted, duplicates, failedPolls,
        alertsProcessed, alertEvents, stats, wallets: results.map((r) => ({ wallet: r.wallet, ok: r.ok, coverage: r.coverage,
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
    await delivery?.close();
    await team?.close();
    await store.close();
    await closeDatabase();
  }
}

main().catch(() => { console.error("sentinel-monitor-failed"); process.exitCode ??= 1; }).finally(closeDatabase);
