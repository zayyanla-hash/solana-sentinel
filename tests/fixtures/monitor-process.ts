import { PostgresIngestionStore } from "../../packages/database/src/ingestion";
import { PollingMonitor } from "../../packages/pipeline/src/monitor";

const wallet = "11111111111111111111111111111111";
const other = "So11111111111111111111111111111111111111112";
const sig = `${"1".repeat(63)}2`;
const raw = {
  slot: 101, blockTime: 1_700_000_001,
  transaction: { signatures: [sig], message: {
    accountKeys: [{ pubkey: wallet, signer: true }, { pubkey: other, signer: false }],
    instructions: [{ programId: wallet, accounts: [], data: "", parsed: {
      type: "transfer", info: { source: wallet, destination: other, lamports: 100_000_000 },
    } }],
  } },
  meta: { err: null, fee: 5000, preBalances: [1_000_000_000, 0],
    postBalances: [899_995_000, 100_000_000], preTokenBalances: [], postTokenBalances: [] },
};
const reader = {
  async verifyMainnet() { /* synthetic finalized ledger */ },
  async signatures(_wallet: string, before: string | null) {
    return before ? [] : [{ signature: sig, slot: 101, blockTime: 1_700_000_001, err: null, confirmationStatus: "finalized" as const }];
  },
  async transaction() { return raw; },
};

const mode = process.argv[2];
const url = process.env.SENTINEL_MONITOR_SCOPED_URL;
if (!url) throw new Error("missing-scoped-test-url");
const db = new PostgresIngestionStore(url);
const hold = async () => { setInterval(() => undefined, 1000); await new Promise<void>(() => undefined); };
const store = {
  getCheckpoint: (address: string) => db.getCheckpoint(address),
  commitPage: async (...args: Parameters<PostgresIngestionStore["commitPage"]>) => {
    if (mode === "before-commit") { process.send?.({ phase: "before-commit" }); await hold(); }
    const result = await db.commitPage(...args);
    if (mode === "after-commit") { process.send?.({ phase: "after-commit" }); await hold(); }
    return result;
  },
};

async function main() {
  const monitor = new PollingMonitor(reader, store, { pageSize: 2, maxPagesPerCycle: 1,
    clock: () => new Date("2026-09-30T12:00:00.000Z") });
  const result = await monitor.pollWallet(wallet);
  process.send?.({ phase: "completed", result });
  await db.close();
  process.disconnect?.();
}
main().catch((error) => {
  process.send?.({ phase: "failed", error: String(error) });
  process.exitCode = 1;
  process.disconnect?.();
});
