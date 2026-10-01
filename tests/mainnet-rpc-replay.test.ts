import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { interpretRpcTransaction } from "../packages/solana/src/rpc-reader";

const load = (path: string) => JSON.parse(readFileSync(resolve(path), "utf8"));
const labels = load("artifacts/session-2/mainnet-labels.json");
const replay = load("tests/fixtures/mainnet-rpc/replay.json");
const buyDevelopment = load("tests/fixtures/mainnet-rpc/buy-development.json");
const primarySignature = "31nWgoSACaQKTNe5bUYsomXCBRV3sKKqzA1Q6nKoEiRFud2NXnJk3NGaUck2zQaRQkr349TZJ2SHMe6rXLkbJPCE";
const primary = replay.transactions.find((record: { signature: string }) => record.signature === primarySignature)!;

describe("independently labeled public finalized RPC replay", () => {
  it("preserves the pre-change baseline and explicit tiny directional denominator", () => {
    expect(labels.baselinePredictions).toHaveLength(13);
    expect(labels.baselinePredictions.filter((prediction: { outcome: string }) => prediction.outcome === "UNKNOWN")).toHaveLength(9);
    expect(labels.baselinePredictions.filter((prediction: { outcome: string }) => prediction.outcome === "FAILED")).toHaveLength(4);
    expect(labels.labels.filter((label: { includeInPrecision: boolean }) => label.includeInPrecision)).toHaveLength(1);
    expect(labels.accuracy).toBeNull();
  });

  it("matches evidence labels without promoting ambiguous or failed transactions", () => {
    const artifacts = new Map([
      ["mainnet-unreviewed.json", load("artifacts/session-2/mainnet-unreviewed.json")],
      ["mainnet-second-sample.json", load("artifacts/session-2/mainnet-second-sample.json")],
    ]);
    for (const label of labels.labels) {
      const source = artifacts.get(label.sourceArtifact)!.transactions[label.sourceIndex];
      expect(source.signature).toBe(label.signature);
      const result = interpretRpcTransaction(source.signature, source.wallet, source.raw);
      expect(result.outcome, label.signature).toBe(label.expected.outcome);
      if (label.includeInPrecision) {
        expect(result.trades, label.signature).toHaveLength(1);
        expect(result.trades[0]).toMatchObject({ side: label.expected.side, mint: label.expected.mint,
          qty: label.expected.qty, sourceSignature: label.signature, isDemo: false });
      } else {
        expect(result.trades, label.signature).toEqual([]);
      }
    }
  });

  it("the sanitized fixture retains the sale proof and abstention controls", () => {
    expect(replay.transactions).toHaveLength(7);
    for (const record of replay.transactions) {
      const label = labels.labels.find((candidate: { signature: string }) => candidate.signature === record.signature)!;
      const result = interpretRpcTransaction(record.signature, record.wallet, record.raw);
      expect(result.outcome, record.signature).toBe(label.expected.outcome);
    }
  });

  it("requires every ownership, route, wrap, close, and native-accounting proof", () => {
    const mutations: Array<[string, (tx: typeof primary.raw) => void]> = [
      ["Jupiter authority", (tx) => { tx.transaction.message.instructions[3].accounts[1] = "So11111111111111111111111111111111111111112"; }],
      ["source account", (tx) => { tx.transaction.message.instructions[3].accounts[2] = "So11111111111111111111111111111111111111112"; }],
      ["token account owner", (tx) => { tx.meta.preTokenBalances.find((b: { accountIndex: number }) => b.accountIndex === 5).owner = "So11111111111111111111111111111111111111112"; }],
      ["inner token amount", (tx) => { tx.meta.innerInstructions.find((g: { index: number }) => g.index === 3).instructions[2].parsed.info.tokenAmount.amount = "1"; }],
      ["Pump SellV2 log", (tx) => { tx.meta.logMessages = tx.meta.logMessages.filter((line: string) => line !== "Program log: Instruction: SellV2"); }],
      ["Pump instruction discriminator", (tx) => { tx.meta.innerInstructions.find((g: { index: number }) => g.index === 3).instructions[0].data = "1".repeat(24); }],
      ["Pump user role", (tx) => { tx.meta.innerInstructions.find((g: { index: number }) => g.index === 3).instructions[0].accounts[13] = "So11111111111111111111111111111111111111112"; }],
      ["second Pump sale", (tx) => { const group = tx.meta.innerInstructions.find((g: { index: number }) => g.index === 3); group.instructions.push(structuredClone(group.instructions[0])); }],
      ["wrapped account owner", (tx) => { tx.transaction.message.instructions[2].parsed.info.wallet = "So11111111111111111111111111111111111111112"; }],
      ["wrap destination", (tx) => { tx.meta.innerInstructions.find((g: { index: number }) => g.index === 3).instructions[4].parsed.info.destination = primary.wallet; }],
      ["close destination", (tx) => { tx.transaction.message.instructions[4].parsed.info.destination = "So11111111111111111111111111111111111111112"; }],
      ["temporary account already funded", (tx) => { tx.meta.preBalances[10] = 1; tx.meta.postBalances[10] = 1; }],
      ["native attribution", (tx) => { tx.meta.postBalances[0] += 1; }],
      ["unrelated top transfer", (tx) => { tx.transaction.message.instructions.push({ programId: "11111111111111111111111111111111", parsed: { type: "transfer", info: { source: primary.wallet, destination: "So11111111111111111111111111111111111111112", lamports: 1 } } }); }],
    ];
    for (const [proof, mutate] of mutations) {
      const tx = structuredClone(primary.raw);
      mutate(tx);
      const result = interpretRpcTransaction(primary.signature, primary.wallet, tx);
      expect(result.outcome, proof).toBe("UNKNOWN");
      expect(result.trades, proof).toEqual([]);
    }
  });
});

describe("narrow Pump BuyExactQuoteInV2 development corpus", () => {
  const primaryBuy = buyDevelopment.transactions[0];
  it("attributes three reviewed raw-source buys with exact wallet token receipts", () => {
    expect(buyDevelopment.transactions).toHaveLength(3);
    for (const record of buyDevelopment.transactions) {
      const result = interpretRpcTransaction(record.signature, record.wallet, record.raw);
      expect(result).toMatchObject({ outcome: "CLASSIFIED", reason: "jupiter-pump-buy-closed-wsol" });
      expect(result.trades).toMatchObject([{ side: "BUY", mint: record.expected.mint,
        qty: record.expected.qty, sourceSignature: record.signature, isDemo: false }]);
    }
  });

  it("abstains when any authority, account, amount, route, or native proof is changed", () => {
    const routeIndex = primaryBuy.raw.transaction.message.instructions.findIndex((ix: { programId: string }) =>
      ix.programId === "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
    const changes: Array<[string, (tx: typeof primaryBuy.raw) => void]> = [
      ["route authority", (tx) => { tx.transaction.message.instructions[routeIndex].accounts[1] =
        "So11111111111111111111111111111111111111112"; }],
      ["wrapped source", (tx) => { tx.transaction.message.instructions[routeIndex].accounts[2] = primaryBuy.wallet; }],
      ["base account owner", (tx) => { tx.meta.postTokenBalances.find((b: { owner: string }) => b.owner === primaryBuy.wallet).owner =
        "So11111111111111111111111111111111111111112"; }],
      ["received amount", (tx) => { tx.meta.postTokenBalances.find((b: { owner: string }) => b.owner === primaryBuy.wallet)
        .uiTokenAmount.amount = "1"; }],
      ["funding amount", (tx) => { tx.transaction.message.instructions[2].parsed.info.lamports += 1; }],
      ["Pump discriminator", (tx) => { tx.meta.innerInstructions.find((g: { index: number }) => g.index === routeIndex)
        .instructions[1].data = "1".repeat(24); }],
      ["Pump user", (tx) => { tx.meta.innerInstructions.find((g: { index: number }) => g.index === routeIndex)
        .instructions[1].accounts[13] = "So11111111111111111111111111111111111111112"; }],
      ["second Pump buy", (tx) => { const group = tx.meta.innerInstructions.find((g: { index: number }) => g.index === routeIndex);
        group.instructions.push(structuredClone(group.instructions[1])); }],
      ["extra top transfer", (tx) => { tx.transaction.message.instructions.push({ programId: "11111111111111111111111111111111",
        parsed: { type: "transfer", info: { source: primaryBuy.wallet, destination: primaryBuy.wallet, lamports: 1 } } }); }],
      ["close owner", (tx) => { tx.transaction.message.instructions.at(-1).parsed.info.owner =
        "So11111111111111111111111111111111111111112"; }],
      ["native accounting", (tx) => { tx.meta.postBalances[0] += 1; }],
    ];
    for (const [proof, mutate] of changes) {
      const raw = structuredClone(primaryBuy.raw);
      mutate(raw);
      const result = interpretRpcTransaction(primaryBuy.signature, primaryBuy.wallet, raw);
      expect(result.outcome, proof).toBe("UNKNOWN");
      expect(result.trades, proof).toEqual([]);
    }
  });
});
