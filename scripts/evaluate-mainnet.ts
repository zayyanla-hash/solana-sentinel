import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { interpretRpcTransaction } from "../packages/solana/src/rpc-reader";

async function main() {
  const directory = path.resolve("artifacts/session-2");
  const labels = JSON.parse(await readFile(path.join(directory, "mainnet-labels.json"), "utf8"));
  const artifacts = new Map<string, { transactions: Array<{ signature: string; wallet: string; raw: Record<string, unknown> }> }>();
  const predictions = [];
  for (const label of labels.labels) {
    if (!artifacts.has(label.sourceArtifact)) {
      // Labels may reference only artifacts beside the reviewed label file.
      if (path.basename(label.sourceArtifact) !== label.sourceArtifact) throw new Error("invalid-source-artifact");
      artifacts.set(label.sourceArtifact, JSON.parse(await readFile(path.join(directory, label.sourceArtifact), "utf8")));
    }
    const source = artifacts.get(label.sourceArtifact)!.transactions[label.sourceIndex];
    if (source.signature !== label.signature || source.wallet !== label.wallet) throw new Error("label-source-mismatch");
    const predicted = interpretRpcTransaction(source.signature, source.wallet, source.raw);
    predictions.push({ signature: source.signature, wallet: source.wallet, expected: label.expected,
      includeInPrecision: label.includeInPrecision, predicted });
  }
  const summarize = (rows: Array<{ signature: string; outcome: string; trades: Array<{ side: string; mint: string; qty: number }> }>) => {
    const outcomes: Record<string, number> = { CLASSIFIED: 0, UNKNOWN: 0, FAILED: 0 };
    let directionalPredictions = 0, correctDirectional = 0, falseBuy = 0, falseSell = 0;
    let excludedDirectional = 0;
    for (const row of rows) {
      outcomes[row.outcome] = (outcomes[row.outcome] ?? 0) + 1;
      const label = labels.labels.find((l: { signature: string }) => l.signature === row.signature);
      for (const trade of row.trades.filter((t) => t.side === "BUY" || t.side === "SELL")) {
        if (!label.includeInPrecision) { excludedDirectional += 1; continue; }
        directionalPredictions += 1;
        const correct = trade.side === label.expected.side && trade.mint === label.expected.mint &&
          Math.abs(trade.qty - label.expected.qty) <= Math.max(1e-9, Math.abs(label.expected.qty) * 1e-12);
        if (correct) correctDirectional += 1;
        else if (trade.side === "BUY") falseBuy += 1;
        else falseSell += 1;
      }
    }
    const reviewedDirectional = labels.labels.filter((l: { includeInPrecision: boolean }) => l.includeInPrecision).length;
    return { outcomes, total: rows.length, directionalPredictions, reviewedDirectional,
      correctDirectional, falseBuy, falseSell, excludedDirectional,
      precision: directionalPredictions ? correctDirectional / directionalPredictions : null,
      recall: reviewedDirectional ? correctDirectional / reviewedDirectional : null,
      abstentionRate: rows.length ? outcomes.UNKNOWN / rows.length : null };
  };
  const result = { schemaVersion: 1, evaluatedAt: new Date().toISOString(),
    scope: labels.scope, accuracy: null,
    warning: "One reviewed directional case; training regression evidence, not an independent holdout or broad accuracy estimate. Eight successful ambiguous cases excluded from directional metrics.",
    baseline: summarize(labels.baselinePredictions),
    current: summarize(predictions.map((p) => ({ signature: p.signature, ...p.predicted }))), predictions };
  await writeFile(path.join(directory, "mainnet-evaluation.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ baseline: result.baseline, current: result.current, accuracy: null }));
}
main().catch(() => { console.error("mainnet-evaluation-failed"); process.exitCode = 1; });
