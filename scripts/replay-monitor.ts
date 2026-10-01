/** Reinterpret immutable observations. Historical replay never creates alert deliveries. */
import { PostgresIngestionStore } from "../packages/database/src/ingestion";
import { SolanaAddressSchema } from "../packages/shared/src/index";
import { interpretRpcTransaction } from "../packages/solana/src/rpc-reader";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const wallet = args.find((arg) => arg.startsWith("--wallet="))?.slice(9);
  const version = Number(args.find((arg) => arg.startsWith("--version="))?.slice(10));
  const apply = args.includes("--apply");
  if (!wallet || !Number.isSafeInteger(version) || version < 2 || !process.env.DATABASE_URL) {
    throw new Error("usage: DATABASE_URL=... tsx scripts/replay-monitor.ts --wallet=<base58> --version=2 [--apply]");
  }
  SolanaAddressSchema.parse(wallet);
  const store = new PostgresIngestionStore(process.env.DATABASE_URL);
  let scanned = 0, inserted = 0, duplicates = 0;
  let before: { slot: number; signature: string } | undefined;
  try {
    for (;;) {
      const batch = await store.getRawObservations(wallet, 100, before);
      if (!batch.length) break;
      for (const row of batch) {
        const interpretation = interpretRpcTransaction(row.signature, wallet, row.raw);
        if (interpretation.slot !== row.slot) throw new Error("replay-source-slot-mismatch");
        scanned++;
        if (apply) {
          const result = await store.recordInterpretation({ wallet, signature: row.signature, version,
            outcome: interpretation.outcome, reason: interpretation.reason, trades: interpretation.trades });
          if (result === "inserted") inserted++; else duplicates++;
        }
      }
      const last = batch.at(-1)!;
      before = { slot: last.slot, signature: last.signature };
    }
    console.log(JSON.stringify({ mode: apply ? "applied" : "dry-run", wallet, version, scanned, inserted, duplicates,
      historicalAlertsCreated: 0 }));
  } finally { await store.close(); }
}
main().catch(() => { console.error("monitor-replay-failed"); process.exitCode = 1; });
