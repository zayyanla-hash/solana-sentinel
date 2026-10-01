import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { PostgresIngestionStore, type ChainObservation } from "../packages/database/src/ingestion";
import { interpretRpcTransaction } from "../packages/solana/src/rpc-reader";

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let n = bytes.reduce((sum, b) => sum * 256n + BigInt(b), 0n), out = "";
  while (n) { out = alphabet[Number(n % 58n)] + out; n /= 58n; }
  return "1".repeat(bytes.findIndex((b) => b !== 0) < 0 ? bytes.length : bytes.findIndex((b) => b !== 0)) + out;
}
async function main() {
  const url = new URL(process.env.SENTINEL_TEST_DATABASE_URL ?? "postgresql://unused@127.0.0.1/unused");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/test/i.test(decodeURIComponent(url.pathname))) {
    throw new Error("disposable-local-test-database-required");
  }
  const count = Number(process.argv.find((a) => a.startsWith("--events="))?.slice(9) ?? 200);
  if (!Number.isSafeInteger(count) || count < 20 || count > 5000 || count % 20) throw new Error("events-must-be-multiple-of-20-up-to-5000");
  const fixture = JSON.parse(await readFile("tests/fixtures/mainnet-rpc/replay.json", "utf8"));
  const example = fixture.transactions.find((row: { raw: unknown; signature: string; wallet: string }) =>
    interpretRpcTransaction(row.signature, row.wallet, row.raw).outcome === "CLASSIFIED");
  if (!example) throw new Error("missing-classified-replay");
  const { Pool } = createRequire(new URL("../packages/database/package.json", import.meta.url))("pg");
  const admin = new Pool({ connectionString: url.toString() });
  const schema = `sat_bench_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${schema}`);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const store = new PostgresIngestionStore(url.toString(), { maxObservations: count });
  try {
    let cp = await store.getCheckpoint(example.wallet);
    const rows: ChainObservation[] = [];
    const parseLatencies = [];
    for (let i = 0; i < count; i++) {
      const signature = base58(createHash("sha512").update(`${schema}:${i}`).digest());
      const raw = structuredClone(example.raw);
      raw.transaction.signatures[0] = signature;
      const start = performance.now();
      const interpreted = interpretRpcTransaction(signature, example.wallet, raw);
      parseLatencies.push(performance.now() - start);
      rows.push({ wallet: example.wallet, signature, raw, ...interpreted });
    }
    const batches = [];
    for (let i = 0; i < count; i += 20) {
      const start = performance.now();
      const result = await store.commitPage(example.wallet, cp.version, rows.slice(i, i + 20),
        { ...cp, anchor: rows[i + 19]!.signature, coverage: "CURRENT", lastSuccessAt: new Date().toISOString() });
      cp = result.checkpoint;
      batches.push(performance.now() - start);
    }
    let suppressed = 0;
    const replayStart = performance.now();
    for (let i = 0; i < count; i += 20) {
      const result = await store.commitPage(example.wallet, cp.version, rows.slice(i, i + 20), cp);
      cp = result.checkpoint; suppressed += result.duplicates;
    }
    const quantiles = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const q = (p: number) => sorted[Math.ceil(sorted.length * p) - 1];
      return { samples: sorted.length, p50Ms: q(0.5), p95Ms: q(0.95), maxMs: sorted.at(-1) };
    };
    const commitMs = batches.reduce((a, b) => a + b, 0);
    const evidence = { at: new Date().toISOString(), scope: "synthetic copies of one finalized RPC shape with generated signatures; isolated local PostgreSQL; no RPC/network latency; one run",
      environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model,
        postgres: (await admin.query("show server_version")).rows[0].server_version },
      count, batchSize: 20, parser: quantiles(parseLatencies), commitBatches: quantiles(batches),
      commitTotalMs: commitMs, recordsPerSecond: count / (commitMs / 1000),
      duplicatesSuppressed: suppressed, duplicateReplayMs: performance.now() - replayStart,
      stats: await store.getStats(), rssBytes: process.memoryUsage().rss };
    await writeFile("artifacts/session-2/monitor-benchmark.json", JSON.stringify(evidence, null, 2) + "\n");
    console.log(JSON.stringify(evidence));
  } finally {
    await store.close();
    await admin.query(`drop schema ${schema} cascade`);
    await admin.end();
  }
}
main().catch(() => { console.error("monitor-benchmark-failed"); process.exitCode = 1; });
