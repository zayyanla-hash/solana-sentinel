import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ReadOnlyRpcReader, interpretRpcTransaction, isTransactionSignature, MAINNET_GENESIS } from "../packages/solana/src/rpc-reader";

// All keys, signatures, balances, and transactions in this file are synthetic.
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let n = bytes.reduce((value, byte) => value * 256n + BigInt(byte), 0n);
  let result = "";
  while (n > 0n) { result = ALPHABET[Number(n % 58n)] + result; n /= 58n; }
  return "1".repeat(bytes.findIndex((b) => b !== 0) < 0 ? bytes.length : bytes.findIndex((b) => b !== 0)) + result;
}
const addr = (byte: number) => base58(Uint8Array.from({ length: 32 }, () => byte));
const sig = base58(Uint8Array.from({ length: 64 }, (_, i) => (i + 7) % 256));
const otherSig = base58(Uint8Array.from({ length: 64 }, (_, i) => (i + 11) % 256));
const wallet = addr(2), authority = addr(3), source = addr(4), destination = addr(5);
const tokenProgram = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const jupiter = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const system = "11111111111111111111111111111111";
const usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const target = addr(8);
const discriminator = (name: string) => base58(createHash("sha256").update(`global:${name}`).digest().subarray(0, 8));
const tokenBalance = (index: number, owner: string, mint: string, amount: string) => ({
  accountIndex: index, mint, owner, uiTokenAmount: { amount, decimals: 6 },
});

function routeTx() {
  return {
    slot: 1234, blockTime: 1_700_000_000,
    transaction: {
      signatures: [sig], message: {
        accountKeys: [
          { pubkey: wallet, signer: true }, { pubkey: authority, signer: true },
          { pubkey: source, signer: false }, { pubkey: destination, signer: false },
        ],
        instructions: [{ programId: jupiter, accounts: [tokenProgram, wallet, source, destination], data: discriminator("route") }],
      },
    },
    meta: {
      err: null, fee: 5000,
      preBalances: [1_000_000_000, 0, 0, 0],
      postBalances: [999_995_000, 0, 0, 0],
      preTokenBalances: [tokenBalance(2, wallet, usdc, "2000000"), tokenBalance(3, wallet, target, "0")],
      postTokenBalances: [tokenBalance(2, wallet, usdc, "1000000"), tokenBalance(3, wallet, target, "500000")],
    },
  };
}
function transferTx() {
  const tx = routeTx();
  tx.transaction.message.instructions = [{
    programId: system, accounts: [], data: "",
    parsed: { type: "transfer", info: { source: wallet, destination: authority, lamports: 100_000_000 } },
  }] as typeof tx.transaction.message.instructions;
  tx.meta.postBalances[0] = 899_995_000;
  tx.meta.postBalances[1] = 100_000_000;
  tx.meta.preTokenBalances = [];
  tx.meta.postTokenBalances = [];
  return tx;
}

describe("finalized RPC interpreter", () => {
  it("accepts only valid 64-byte base58 signatures", () => {
    expect(isTransactionSignature(sig)).toBe(true);
    expect(isTransactionSignature(base58(new Uint8Array(63).fill(1)))).toBe(false);
    expect(isTransactionSignature("not a signature")).toBe(false);
  });

  it("classifies a fee-adjusted direct SOL transfer without calling it a buy", () => {
    const result = interpretRpcTransaction(sig, wallet, transferTx());
    expect(result.outcome).toBe("CLASSIFIED");
    expect(result.trades).toMatchObject([{ side: "TRANSFER_OUT", qty: 0.1, isDemo: false }]);
    expect(result.trades[0]?.sourceSignature).toBe(sig);
  });

  it("abstains on rent or account-closure lamports outside a direct transfer", () => {
    const tx = transferTx();
    tx.transaction.message.instructions[0]!.parsed!.type = "createAccount";
    expect(interpretRpcTransaction(sig, wallet, tx).outcome).toBe("UNKNOWN");
    const close = transferTx();
    close.transaction.message.instructions[0]!.programId = tokenProgram;
    close.transaction.message.instructions[0]!.parsed!.type = "closeAccount";
    expect(interpretRpcTransaction(sig, wallet, close).outcome).toBe("UNKNOWN");
  });

  it("keeps exact net lamports when large intermediate transfers cancel", () => {
    const tx = transferTx();
    tx.transaction.message.instructions = [
      { source: authority, destination: wallet, lamports: Number.MAX_SAFE_INTEGER },
      { source: authority, destination: wallet, lamports: 2 },
      { source: wallet, destination: authority, lamports: Number.MAX_SAFE_INTEGER },
    ].map((info) => ({ programId: system, accounts: [], data: "", parsed: { type: "transfer", info } })) as typeof tx.transaction.message.instructions;
    tx.meta.postBalances[0] = tx.meta.preBalances[0]! - tx.meta.fee + 2;
    expect(interpretRpcTransaction(sig, wallet, tx).trades).toMatchObject([{ side: "TRANSFER_IN", qty: 2e-9 }]);
  });

  it("rejects duplicate account keys rather than attributing balances to the first occurrence", () => {
    const tx = routeTx();
    tx.transaction.message.accountKeys[1]!.pubkey = wallet;
    expect(() => interpretRpcTransaction(sig, wallet, tx)).toThrow("rpc-duplicate-account-key");
  });

  it("rejects failed, unsigned, misidentified, and malformed transactions", () => {
    const failed = routeTx();
    failed.meta.err = { InstructionError: [0, "Custom"] } as typeof failed.meta.err;
    expect(interpretRpcTransaction(sig, wallet, failed)).toMatchObject({ outcome: "FAILED", trades: [] });
    const missing = routeTx() as unknown as { meta: Record<string, unknown> };
    delete missing.meta.err;
    expect(() => interpretRpcTransaction(sig, wallet, missing)).toThrow();
    expect(() => interpretRpcTransaction(otherSig, wallet, routeTx())).toThrow(/signature/);
    expect(() => interpretRpcTransaction(sig, addr(9), routeTx())).toThrow(/wallet/);
    const mismatched = routeTx();
    mismatched.meta.postBalances.pop();
    expect(() => interpretRpcTransaction(sig, wallet, mismatched)).toThrow(/balances/);
  });

  it("classifies only an isolated recognized Jupiter token route", () => {
    const good = interpretRpcTransaction(sig, wallet, routeTx());
    expect(good).toMatchObject({ outcome: "CLASSIFIED", reason: "isolated-jupiter-token-route" });
    expect(good.trades).toMatchObject([{ mint: target, side: "BUY", qty: 0.5, costBasis: "UNPRICED" }]);
    const wrongProgram = routeTx();
    wrongProgram.transaction.message.instructions[0]!.programId = addr(10);
    expect(interpretRpcTransaction(sig, wallet, wrongProgram).outcome).toBe("UNKNOWN");
    const discriminatorUnknown = routeTx();
    discriminatorUnknown.transaction.message.instructions[0]!.data = base58(new Uint8Array(8).fill(9));
    expect(interpretRpcTransaction(sig, wallet, discriminatorUnknown).outcome).toBe("UNKNOWN");
    const combined = routeTx();
    combined.transaction.message.instructions.push({ programId: system, accounts: [], data: "" });
    expect(interpretRpcTransaction(sig, wallet, combined).outcome).toBe("UNKNOWN");
  });

  it("does not infer a trade from a bystander signer listed outside the route authority account", () => {
    const tx = routeTx();
    tx.transaction.message.instructions[0]!.accounts = [tokenProgram, authority, source, destination, wallet];
    expect(interpretRpcTransaction(sig, wallet, tx)).toMatchObject({ outcome: "UNKNOWN", trades: [] });
  });

  it("uses the distinct authority and token account slots of shared-account routes", () => {
    const tx = routeTx();
    tx.transaction.message.instructions[0] = {
      programId: jupiter, data: discriminator("shared_accounts_route"),
      accounts: [tokenProgram, addr(12), wallet, source, addr(13), addr(14), destination],
    };
    expect(interpretRpcTransaction(sig, wallet, tx).outcome).toBe("CLASSIFIED");
    tx.transaction.message.instructions[0]!.accounts[2] = authority;
    tx.transaction.message.instructions[0]!.accounts.push(wallet);
    expect(interpretRpcTransaction(sig, wallet, tx)).toMatchObject({ outcome: "UNKNOWN", trades: [] });
  });

  it("does not attribute unrelated wallet token deltas to route accounts", () => {
    const tx = routeTx();
    tx.transaction.message.instructions[0]!.accounts = [tokenProgram, wallet, addr(15), addr(16)];
    expect(interpretRpcTransaction(sig, wallet, tx)).toMatchObject({ outcome: "UNKNOWN", trades: [] });
  });

  it("abstains on mint or owner changes and imprecise raw quantities", () => {
    const changedMint = routeTx();
    changedMint.meta.postTokenBalances[1]!.mint = addr(11);
    expect(interpretRpcTransaction(sig, wallet, changedMint).outcome).toBe("UNKNOWN");
    const changedOwner = routeTx();
    changedOwner.meta.postTokenBalances[1]!.owner = authority;
    expect(interpretRpcTransaction(sig, wallet, changedOwner).outcome).toBe("UNKNOWN");
    const huge = routeTx();
    huge.meta.postTokenBalances[1]!.uiTokenAmount.amount = "9007199254740993";
    expect(interpretRpcTransaction(sig, wallet, huge).outcome).toBe("UNKNOWN");
  });

  it("abstains when observed balances disagree with parsed transfers", () => {
    const tx = transferTx();
    tx.meta.postBalances[0] -= 1;
    expect(interpretRpcTransaction(sig, wallet, tx)).toMatchObject({ outcome: "UNKNOWN", reason: "native-transfer-balance-mismatch" });
  });
});

describe("read-only RPC reader", () => {
  function fakeRpc(reply: (method: string) => unknown) {
    const calls: Array<{ method: string; params: unknown[] }> = [];
    const fetchFn: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      calls.push(body);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.method, result: reply(body.method) }), { status: 200 });
    };
    return { calls, reader: new ReadOnlyRpcReader("https://rpc.example.test", { fetchFn, maxRetries: 0 }) };
  }

  it("verifies mainnet genesis and refuses a different cluster", async () => {
    const valid = fakeRpc(() => MAINNET_GENESIS);
    await expect(valid.reader.verifyMainnet()).resolves.toBeUndefined();
    const wrong = fakeRpc(() => "different-genesis");
    await expect(wrong.reader.verifyMainnet()).rejects.toThrow(/wrong-cluster/);
  });

  it("requests finalized signatures and rejects an ascending or malformed page", async () => {
    const row = (signature: string, slot: number) => ({ signature, slot, err: null, blockTime: 1_700_000_000, confirmationStatus: "finalized" });
    const ordered = fakeRpc(() => [row(sig, 20), row(otherSig, 19)]);
    await expect(ordered.reader.signatures(wallet, null, 2)).resolves.toHaveLength(2);
    expect(ordered.calls[0]).toMatchObject({ method: "getSignaturesForAddress", params: [wallet, { commitment: "finalized", limit: 2 }] });
    const ascending = fakeRpc(() => [row(sig, 19), row(otherSig, 20)]);
    await expect(ascending.reader.signatures(wallet, null, 2)).rejects.toThrow(/invalid-signature-page/);
    const duplicate = fakeRpc(() => [row(sig, 20), row(sig, 19)]);
    await expect(duplicate.reader.signatures(wallet, null, 2)).rejects.toThrow(/invalid-signature-page/);
    const unfinalized = fakeRpc(() => [{ ...row(sig, 20), confirmationStatus: "confirmed" }]);
    await expect(unfinalized.reader.signatures(wallet, null, 2)).rejects.toThrow(/invalid-signature-page/);
  });

  it("uses finalized parsed transactions and has no signing or broadcasting method", async () => {
    const rpc = fakeRpc(() => routeTx());
    await expect(rpc.reader.transaction(sig)).resolves.toMatchObject({ slot: 1234 });
    expect(rpc.calls[0]).toMatchObject({ method: "getTransaction", params: [sig, {
      commitment: "finalized", encoding: "jsonParsed", maxSupportedTransactionVersion: 0,
    }] });
    expect("sendTransaction" in rpc.reader).toBe(false);
    expect("signTransaction" in rpc.reader).toBe(false);
  });
});
