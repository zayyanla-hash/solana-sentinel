import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ReadOnlyRpcReader, interpretRpcTransaction } from "../packages/solana/src/rpc-reader";

async function main() {
const args = process.argv.slice(2);
const param = (name: string) => args.find((x) => x.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const endpoint = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const address = param("address") ?? "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const count = Number(param("count") ?? 8);
if (!Number.isSafeInteger(count) || count < 1 || count > 50) throw new Error("count-must-be-1-to-50");
const output = path.resolve(param("output") ?? "artifacts/session-2/mainnet-unreviewed.json");
const reader = new ReadOnlyRpcReader(endpoint, { timeoutMs: 15_000, maxRetries: 2 });
const controller = new AbortController();
for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => controller.abort());
const data: Array<Record<string, unknown>> = [];
const errors: Array<{ signature?: string; reason: string }> = [];
await reader.verifyMainnet(controller.signal);
const selectedSignatures = param("signatures")?.split(",");
if (selectedSignatures && selectedSignatures.length > 50) throw new Error("too-many-signatures");
const rows = selectedSignatures?.map((signature) => ({ signature })) ?? await reader.signatures(address, null, count, controller.signal);
for (const row of rows) {
  if (controller.signal.aborted) break;
  try {
    const raw = await reader.transaction(row.signature, controller.signal);
    const tx = raw.transaction as { message?: { accountKeys?: Array<{ pubkey: string; signer: boolean }> } };
    const wallet = tx?.message?.accountKeys?.[0]?.pubkey;
    if (!wallet) throw new Error("missing-wallet-perspective");
    let interpretation;
    try { interpretation = interpretRpcTransaction(row.signature, wallet, raw); }
    catch { interpretation = { outcome: "UNKNOWN", reason: "invalid-or-unsupported-rpc-data", trades: [] }; }
    data.push({ signature: row.signature, wallet, protocol: "UNREVIEWED", expected: null,
      labelStatus: "UNREVIEWED", source: "solana-mainnet-finalized-rpc", acquiredAt: new Date().toISOString(),
      raw, interpretation });
  } catch (error) {
    errors.push({ signature: row.signature, reason: error instanceof Error && /^rpc-[a-z-]+$/.test(error.message)
      ? error.message : error instanceof Error ? error.name : "acquisition-failed" });
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
}
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ schemaVersion: 1, acquiredAt: new Date().toISOString(),
  scope: "public-program-sample-fee-payer-perspective", address, commitment: "finalized",
  labelStatus: "UNREVIEWED", accuracy: null, transactions: data, errors }, null, 2) + "\n");
console.log(JSON.stringify({ output, acquired: data.length, failed: errors.length, accuracy: null }));
if (errors.length) process.exitCode = 1;
}
main().catch(() => { console.error("mainnet-collection-failed"); process.exitCode = 1; });
