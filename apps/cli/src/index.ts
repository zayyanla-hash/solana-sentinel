#!/usr/bin/env node
import {
  analyzeWallet,
  generateSmartMoneySignals,
  getSystemHealth,
  listWalletIntelligence,
  runStrategyLab,
  evaluateMint,
  portfolioRiskSnapshot,
  addWatchlistItem,
  verifyLiveWallet,
  compareWalletProviders,
  closeProviders,
} from "@sat/pipeline";
import { getDatabase, closeDatabase } from "@sat/database";
import { isLiveTradingAllowed } from "@sat/shared";

function json(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

async function main(): Promise<void> {
  const raw = process.argv.slice(2);
  const flags = new Set(raw.filter((a) => a.startsWith("--")));
  const positional = raw.filter((a) => !a.startsWith("--"));
  const [cmd, arg] = positional;
  const db = getDatabase();
  if (!cmd || cmd === "help" || cmd === "--help") {
    json({
      commands: [
        "sentinel health",
        "sentinel opportunities",
        "sentinel analyze-token <mint>",
        "sentinel analyze-wallet <address>",
        "sentinel explain-signal <id>",
        "sentinel backtest [mint]",
        "sentinel portfolio-risk",
        "sentinel watchlist-add <mint|wallet>",
        "sentinel analyze-wallet --live <address>",
        "sentinel compare-providers <address>",
      ],
      liveTradingAllowed: isLiveTradingAllowed(),
      note: "JSON output. No secrets. PAPER only.",
    });
    return;
  }
  switch (cmd) {
    case "health":
      json({ ...(await getSystemHealth(db)), liveTradingAllowed: false, canBroadcast: false });
      return;
    case "opportunities":
      json({ candidates: (await db.getState()).candidates, wallets: await listWalletIntelligence() });
      return;
    case "analyze-token":
      if (!arg) throw new Error("mint required");
      json({ proposal: await evaluateMint(arg, db) });
      return;
    case "analyze-wallet": {
      if (!arg) throw new Error("wallet required");
      if (flags.has("--live")) {
        json(await verifyLiveWallet(arg));
        return;
      }
      json({ score: await analyzeWallet(arg, db) });
      return;
    }
    case "compare-providers":
      if (!arg) throw new Error("address required");
      json(await compareWalletProviders(arg));
      return;
    case "explain-signal": {
      const signals = await generateSmartMoneySignals(db);
      json({ signal: signals.find((s) => s.id === arg) ?? signals[0] ?? null });
      return;
    }
    case "backtest":
      json({ backtest: await runStrategyLab({ mint: arg, db, walkForward: true }) });
      return;
    case "portfolio-risk":
      json({ ...(await portfolioRiskSnapshot(db)), liveTradingAllowed: false });
      return;
    case "watchlist-add":
      if (!arg) throw new Error("address required");
      json({
        item: await addWatchlistItem({
          kind: arg.length > 40 ? "MINT" : "WALLET",
          address: arg,
          db,
        }),
      });
      return;
    default:
      throw new Error(`unknown command ${cmd}`);
  }
}

async function cleanup() {
  await closeProviders();
  await closeDatabase();
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    void closeProviders().catch(() => { process.exitCode = 1; });
  });
}

main().finally(cleanup).catch((err) => {
  json({ error: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
});
