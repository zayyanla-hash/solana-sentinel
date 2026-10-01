import { DurableWalletHistoryProvider } from "../../packages/solana/src/durable-history";
import { parseHeliusEnhancedTx } from "../../packages/solana/src/normalize";
import { JUP, USDC } from "../../packages/shared/src/index";
import type { WalletHistoryProvider } from "../../packages/solana/src/history-types";

const [directory, mode] = process.argv.slice(2);
const W = "1".repeat(32);
const source: WalletHistoryProvider = { name: "synthetic-process-fixture", isDemo: false, getTrades: async () => ({
  address: W, trades: parseHeliusEnhancedTx(W, {
    signature: mode === "partial-write" ? "synthetic-new" : "synthetic-seed",
    timestamp: mode === "partial-write" ? 1_700_000_001 : 1_700_000_000,
    type: "SWAP", events: { swap: { tokenInputs: [{ mint: USDC, userAccount: W, tokenAmount: 1 }], tokenOutputs: [{ mint: JUP, userAccount: W, tokenAmount: 2 }] } },
  }), freshness: "FRESH", isDemo: false, provenance: ["SYNTHETIC process fixture"], provider: "synthetic-process-fixture",
  diagnostics: { status: "COMPLETE", pages: 1, received: 1, rejected: 0, duplicates: 0, retries: 0 },
}) };
let keepalive: ReturnType<typeof setInterval> | undefined;
const provider = new DurableWalletHistoryProvider(source, directory!, { beforeRename: mode === "partial-write" ? async () => {
  keepalive = setInterval(() => undefined, 1000);
  process.send?.({ phase: "before-rename" });
  await new Promise<void>(() => undefined);
} : undefined });
async function stop() {
  await provider.close();
  if (keepalive) clearInterval(keepalive);
  process.disconnect?.();
}
process.once("SIGTERM", () => { void stop().catch(() => { process.exitCode = 1; }); });
process.once("SIGINT", () => { void stop().catch(() => { process.exitCode = 1; }); });
async function main() {
  const result = await provider.getTrades(W);
  process.send?.({ phase: "committed", trades: result.trades.length });
  if (mode === "seed") keepalive = setInterval(() => undefined, 1000);
  else await stop();
}
main().catch(() => { process.exitCode = 1; process.disconnect?.(); });
