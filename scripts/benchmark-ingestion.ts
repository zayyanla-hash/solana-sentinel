import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { cpus, platform, release, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { JUP, USDC } from "../packages/shared/src/index";
import { normalizeEnhancedTx, classifyWalletActivity, dedupeTrades } from "../packages/solana/src/normalize";
import { DurableWalletHistoryProvider } from "../packages/solana/src/durable-history";
import type { WalletHistoryProvider, WalletHistoryResult } from "../packages/solana/src/history-types";

const W = "1".repeat(32);
async function main() {
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const count = Number(option("events") ?? 5000);
const runs = Number(option("runs") ?? 5);
if (!Number.isInteger(count) || count < 100 || count > 10_000 || !Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error("invalid-benchmark-options");
const rows = Array.from({ length: count }, (_, i) => ({
  signature: createHash("sha512").update(`synthetic-${i}`).digest("hex"),
  timestamp: 1_700_000_000 + i, type: "SWAP", transactionError: null,
  events: { swap: {
    tokenInputs: [{ userAccount: W, mint: USDC, rawTokenAmount: { tokenAmount: "1000000", decimals: 6 } }],
    tokenOutputs: [{ userAccount: W, mint: JUP, rawTokenAmount: { tokenAmount: "500000000", decimals: 6 } }],
  } },
}));
function interpret(row: typeof rows[number]) {
  const ev = normalizeEnhancedTx(row, W);
  if (!ev) throw new Error("benchmark-normalization-failed");
  return classifyWalletActivity(ev, W);
}
const quantile = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * q)]!;
const startingMemory = process.memoryUsage();
let maxRss = startingMemory.rss;
for (const row of rows.slice(0, 100)) interpret(row);
const results = [];
const cpuStart = process.cpuUsage();
for (let run = 0; run < runs; run++) {
  const latencies: number[] = [];
  const trades = [];
  const start = performance.now();
  for (const row of rows) {
    const before = performance.now();
    trades.push(...interpret(row));
    latencies.push(performance.now() - before);
  }
  const deduped = dedupeTrades([...trades, ...trades]);
  if (deduped.trades.length !== count || deduped.duplicates !== count || deduped.conflicts !== 0) throw new Error("benchmark-idempotency-failed");
  const durationMs = performance.now() - start;
  maxRss = Math.max(maxRss, process.memoryUsage().rss);
  results.push({ run: run + 1, events: count, duplicateReplayEvents: count, durationMs,
    eventsPerSecond: count / (durationMs / 1000), p50Ms: quantile(latencies, 0.5),
    p95Ms: quantile(latencies, 0.95), p99Ms: quantile(latencies, 0.99),
    duplicatesSuppressed: deduped.duplicates, errors: 0, unknown: 0 });
}
const dir = await mkdtemp(join(tmpdir(), "sentinel-benchmark-"));
let provider: DurableWalletHistoryProvider | undefined;
let archiveEvidence;
try {
  const trades = rows.flatMap(interpret);
  let requests = 0;
  const snapshot: WalletHistoryResult = { address: W, trades, isDemo: false, provider: "synthetic-benchmark", freshness: "FRESH",
    provenance: ["SYNTHETIC offline performance fixture; no mainnet data"],
    diagnostics: { status: "COMPLETE", pages: 1, received: count, rejected: 0, duplicates: 0, retries: 0 } };
  const source: WalletHistoryProvider = { name: "synthetic-benchmark", isDemo: false, getTrades: async () => { requests++; return snapshot; } };
  provider = new DurableWalletHistoryProvider(source, dir);
  const start = performance.now();
  const batch = await Promise.all(Array.from({ length: 32 }, () => provider!.getTrades(W)));
  const firstCommitMs = performance.now() - start;
  if (requests !== 1 || batch.some((r) => r.trades.length !== count)) throw new Error("benchmark-coalescing-failed");
  await provider.close();
  provider = new DurableWalletHistoryProvider(source, dir);
  const replay = performance.now();
  const recovered = await provider.getTrades(W);
  const restartReplayMs = performance.now() - replay;
  if (recovered.trades.length !== count) throw new Error("benchmark-restart-failed");
  archiveEvidence = { uniqueTrades: count, concurrentDuplicateCallers: 32, upstreamCallsForBurst: 1,
    firstCommitMs, restartReplayMs, replayDuplicatedTrades: 0, checkpoint: await provider.checkpoint(W) };
} finally {
  await provider?.close();
  await rm(dir, { recursive: true, force: true });
}
const endMemory = process.memoryUsage();
const cpu = process.cpuUsage(cpuStart);
const report = {
  name: "synthetic-offline-ingestion", version: 1, at: new Date().toISOString(),
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  trackedChanges: execFileSync("git", ["diff", "--name-only"], { encoding: "utf8" }).trim().split("\n").filter(Boolean),
  environment: { node: process.version, os: platform(), release: release(), arch: process.arch,
    cpu: cpus()[0]?.model, logicalCpus: cpus().length },
  conditions: "Synthetic repeated USDC->token shape; in-process normalization/classification and duplicate replay. No RPC/WSS/mainnet traffic. Latencies exclude acquisition, network and durable writes. Archive timings use local fsync+rename. RSS is sampled at run boundaries, not a continuous peak; no forced GC.",
  runs: results, archive: archiveEvidence,
  memoryBytes: { rssStart: startingMemory.rss, rssEnd: endMemory.rss, rssMaxSampled: Math.max(maxRss, endMemory.rss),
    heapStart: startingMemory.heapUsed, heapEnd: endMemory.heapUsed },
  cpuMicroseconds: cpu,
};
const output = option("output");
if (output) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + "\n"); }
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}
main().catch(() => { process.stderr.write("benchmark-failed\n"); process.exitCode = 1; });
