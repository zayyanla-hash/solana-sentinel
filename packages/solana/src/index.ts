import type { OnChainRiskInput } from "@sat/token-risk";
import { getDemoCandidates } from "@sat/shared";
import { requestJson } from "./http";
import { setProviderHealth } from "@sat/observability";

export interface OnChainProvider {
  readonly name: string;
  readonly isDemo: boolean;
  getTokenRiskInputs(mint: string): Promise<OnChainRiskInput>;
}

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** Conservative unknown profile — never pretend mint/freeze authorities are revoked. */
export const UNKNOWN_ONCHAIN_RISK: OnChainRiskInput = {
  tokenProgram: "UNKNOWN",
  mintAuthority: null,
  freezeAuthority: null,
  permanentDelegate: null,
  transferRestrictions: null,
  transferHook: null,
  token2022Extensions: null,
  topHolderConcentrationPct: null,
  top5HolderConcentrationPct: null,
  top10HolderConcentrationPct: null,
  top20HolderConcentrationPct: null,
  exitLiquidityUsd: null,
  jupiterVerified: null,
  jupiterOrganicScore: null,
  creatorHoldingPct: null,
  lpConcentrationPct: null,
  estimatedPriceImpactPct: null,
  metadataQuality: null,
};

function authorityEnabled(value: unknown): boolean | null {
  if (value === undefined) return null;
  if (value === null || value === "") return false;
  return true;
}

type MintExtensions = Record<string, unknown> | null | undefined;

const KNOWN_EXTENSION_KEYS = [
  "transfer_fee_config",
  "transfer_hook",
  "permanent_delegate",
  "default_account_state",
  "confidential_transfer_mint",
  "interest_bearing_config",
  "non_transferable",
  "mint_close_authority",
  "metadata_pointer",
  "metadata",
  "pausable",
  "scaled_ui_amount",
  "confidential_transfer_fee_config",
  "group_pointer",
  "group_member_pointer",
  "transfer_fee_amount",
] as const;

export function parseMintExtensions(ext: MintExtensions): {
  extensions: string[] | null;
  permanentDelegate: boolean | null;
  transferHook: boolean | null;
  transferRestrictions: boolean | null;
} {
  if (ext == null || typeof ext !== "object") {
    return {
      extensions: null,
      permanentDelegate: null,
      transferHook: null,
      transferRestrictions: null,
    };
  }
  const keys = Object.keys(ext).filter((k) => ext[k] != null);
  const listed = keys.filter((k) =>
    (KNOWN_EXTENSION_KEYS as readonly string[]).includes(k),
  );
  const permanent = ext.permanent_delegate;
  let permanentDelegate: boolean | null = false;
  if (permanent && typeof permanent === "object") {
    const delegate = (permanent as { delegate?: unknown }).delegate;
    permanentDelegate = authorityEnabled(delegate) === true;
  } else if ("permanent_delegate" in ext) {
    permanentDelegate = authorityEnabled(permanent) === true;
  }

  const hook = ext.transfer_hook;
  let transferHook = false;
  if ("transfer_hook" in ext) {
    if (hook && typeof hook === "object") {
      const programId = (hook as { program_id?: unknown }).program_id;
      transferHook = authorityEnabled(programId) === true;
    } else {
      transferHook = Boolean(hook);
    }
  }

  const nonTransferable = "non_transferable" in ext && ext.non_transferable != null;
  const frozenDefault =
    typeof ext.default_account_state === "object" &&
    ext.default_account_state != null &&
    String((ext.default_account_state as { state?: unknown }).state ?? "")
      .toLowerCase()
      .includes("freeze");
  const transferRestrictions = transferHook || nonTransferable || frozenDefault;

  return {
    extensions: listed.length ? listed : [],
    permanentDelegate,
    transferHook,
    transferRestrictions,
  };
}

export function concentrationFromLargestAccounts(
  accounts: Array<{ amount?: string; uiAmount?: number | null; uiAmountString?: string }>,
  supplyRaw: string | number | null,
): { top5: number | null; top10: number | null; top20: number | null; topN: number | null } {
  if (supplyRaw == null) {
    return { top5: null, top10: null, top20: null, topN: null };
  }
  const supply = typeof supplyRaw === "string" ? Number(supplyRaw) : Number(supplyRaw);
  if (!Number.isFinite(supply) || supply <= 0) {
    return { top5: null, top10: null, top20: null, topN: null };
  }
  const amounts = accounts
    .map((a) => {
      if (a.amount != null && a.amount !== "") {
        const n = Number(a.amount);
        return Number.isFinite(n) ? n : 0;
      }
      if (a.uiAmountString) {
        const n = Number(a.uiAmountString);
        return Number.isFinite(n) ? n : 0;
      }
      return typeof a.uiAmount === "number" ? a.uiAmount : 0;
    })
    .filter((n) => n > 0)
    .sort((a, b) => b - a);
  if (!amounts.length) return { top5: null, top10: null, top20: null, topN: null };
  const pct = (n: number) =>
    Math.min(100, (amounts.slice(0, n).reduce((s, x) => s + x, 0) / supply) * 100);
  return {
    top5: pct(5),
    top10: pct(10),
    top20: pct(20),
    topN: pct(amounts.length),
  };
}

export class DemoOnChainProvider implements OnChainProvider {
  readonly name = "demo-onchain";
  readonly isDemo = true;

  async getTokenRiskInputs(mint: string): Promise<OnChainRiskInput> {
    const demo = getDemoCandidates().find((c) => c.mint === mint);
    if (!demo) return { ...UNKNOWN_ONCHAIN_RISK };
    if (demo.symbol === "SCAMX") {
      return {
        tokenProgram: "TOKEN_2022",
        mintAuthority: true,
        freezeAuthority: true,
        permanentDelegate: true,
        transferRestrictions: true,
        transferHook: true,
        token2022Extensions: ["permanent_delegate", "transfer_hook"],
        topHolderConcentrationPct: 92,
        top5HolderConcentrationPct: 88,
        top10HolderConcentrationPct: 92,
        top20HolderConcentrationPct: 96,
        exitLiquidityUsd: 3_000,
        estimatedPriceImpactPct: 18,
        metadataQuality: 0.2,
      };
    }
    return {
      tokenProgram: "TOKEN",
      mintAuthority: false,
      freezeAuthority: false,
      permanentDelegate: false,
      transferRestrictions: false,
      transferHook: false,
      token2022Extensions: [],
      topHolderConcentrationPct: 28,
      top5HolderConcentrationPct: 22,
      top10HolderConcentrationPct: 28,
      top20HolderConcentrationPct: 34,
      exitLiquidityUsd: demo.liquidityUsd ?? 1_000_000,
      estimatedPriceImpactPct: 0.35,
      metadataQuality: 0.85,
    };
  }
}

/**
 * Helius DAS + Solana RPC adapter.
 * - getAsset docs: https://www.helius.dev/docs/api-reference/das/getasset
 * - Token-2022 mint_extensions: https://www.helius.dev/docs/das/fungible-token-extension
 * - Mint/freeze live on token_info (not authorities[].type).
 * - Holders: getTokenLargestAccounts + getTokenSupply (Solana JSON-RPC).
 */
export class HeliusOnChainProvider implements OnChainProvider {
  readonly name = "helius";
  readonly isDemo = false;

  constructor(
    private readonly apiKey: string,
    private readonly rpcUrl?: string,
  ) {}

  private endpoint(): string {
    return (
      this.rpcUrl ??
      process.env.HELIUS_RPC_URL ??
      `https://mainnet.helius-rpc.com/?api-key=${this.apiKey}`
    );
  }

  async getTokenRiskInputs(mint: string): Promise<OnChainRiskInput> {
    try {
      const assetJson = await this.rpc("getAsset", {
        id: mint,
        options: { showFungible: true },
      });
      const result = assetJson.result as
        | {
            token_info?: {
              token_program?: string;
              supply?: number | string;
              mint_authority?: string | null;
              freeze_authority?: string | null;
            };
            mint_extensions?: Record<string, unknown>;
            content?: { metadata?: { name?: string; symbol?: string } };
          }
        | undefined;
      if (!result) throw new Error("no result");

      const program = result.token_info?.token_program;
      let tokenProgram: OnChainRiskInput["tokenProgram"] = "UNKNOWN";
      if (program === TOKEN_PROGRAM) tokenProgram = "TOKEN";
      if (program === TOKEN_2022_PROGRAM) tokenProgram = "TOKEN_2022";

      const meta = result.content?.metadata;
      const metadataQuality = meta?.name && meta?.symbol ? 0.8 : 0.3;

      let extensions: ReturnType<typeof parseMintExtensions> = {
        extensions: tokenProgram === "TOKEN" ? [] : null,
        permanentDelegate: tokenProgram === "TOKEN" ? false : null,
        transferHook: tokenProgram === "TOKEN" ? false : null,
        transferRestrictions: tokenProgram === "TOKEN" ? false : null,
      };
      if (tokenProgram === "TOKEN_2022") {
        extensions = parseMintExtensions(result.mint_extensions);
      }

      let top5: number | null = null;
      let top10: number | null = null;
      let top20: number | null = null;
      let topN: number | null = null;
      try {
        const [largest, supply] = await Promise.all([
          this.rpc("getTokenLargestAccounts", [mint]),
          this.rpc("getTokenSupply", [mint]),
        ]);
        const largestValue = (largest.result as { value?: unknown } | undefined)?.value;
        const accounts = (Array.isArray(largestValue) ? largestValue : []) as Array<{
          amount?: string;
          uiAmount?: number | null;
          uiAmountString?: string;
        }>;
        const supplyValue = (supply.result as { value?: { amount?: string } } | undefined)?.value;
        const supplyAmount =
          supplyValue?.amount ??
          (result.token_info?.supply != null ? String(result.token_info.supply) : null);
        const conc = concentrationFromLargestAccounts(accounts, supplyAmount ?? null);
        top5 = conc.top5;
        top10 = conc.top10;
        top20 = conc.top20;
        topN = conc.topN;
      } catch {
        top5 = null;
        top10 = null;
        top20 = null;
        topN = null;
      }

      return {
        tokenProgram,
        mintAuthority: authorityEnabled(result.token_info?.mint_authority),
        freezeAuthority: authorityEnabled(result.token_info?.freeze_authority),
        permanentDelegate: extensions.permanentDelegate,
        transferRestrictions: extensions.transferRestrictions,
        transferHook: extensions.transferHook,
        token2022Extensions: extensions.extensions,
        topHolderConcentrationPct: top5 ?? topN,
        top5HolderConcentrationPct: top5,
        top10HolderConcentrationPct: top10,
        top20HolderConcentrationPct: top20,
        exitLiquidityUsd: null,
        estimatedPriceImpactPct: null,
        metadataQuality,
      };
    } catch {
      return { ...UNKNOWN_ONCHAIN_RISK };
    }
  }

  private async rpc(
    method: string,
    params: unknown,
  ): Promise<{ result?: Record<string, unknown>; error?: { message?: string } }> {
    const body =
      method === "getAsset"
        ? { jsonrpc: "2.0", id: `sat-${method}`, method, params }
        : { jsonrpc: "2.0", id: `sat-${method}`, method, params };
    const started = Date.now();
    try {
    const response = await requestJson(this.endpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = response.value as {
      result?: Record<string, unknown>;
      error?: { message?: string };
    };
    if (!json || typeof json !== "object" || Array.isArray(json) || json.error || !json.result || typeof json.result !== "object") throw new Error("helius-rpc-invalid-response");
    setProviderHealth({ name: this.name, status: "healthy", isDemo: false, lastSuccessAt: new Date().toISOString(), lastError: null, latencyMs: Date.now() - started, dataAgeMs: null });
    return json;
    } catch {
      setProviderHealth({ name: this.name, status: "degraded", isDemo: false, lastSuccessAt: null, lastError: "helius-rpc-request-failed", latencyMs: Date.now() - started, dataAgeMs: null });
      throw new Error("helius-rpc-request-failed");
    }
  }
}

export function createOnChainProvider(): OnChainProvider {
  const key = process.env.HELIUS_API_KEY;
  if (key) return new HeliusOnChainProvider(key);
  return new DemoOnChainProvider();
}

export const KNOWN_PROGRAMS = {
  TOKEN: TOKEN_PROGRAM,
  TOKEN_2022: TOKEN_2022_PROGRAM,
} as const;

export {
  DemoWalletHistoryProvider,
  FixtureWalletHistoryProvider,
  HeliusWalletHistoryProvider,
  createWalletHistoryProvider,
  createLiveWalletHistoryProvider,
  type WalletHistoryProvider,
  type WalletHistoryResult,
} from "./wallet-history";
export {
  HeliusParsedEventsProvider,
  HeliusEnhancedTransactionsProvider,
  CompositeHeliusHistoryProvider,
} from "./parsed-events";
export {
  fetchJupiterTokenIntel,
  EMPTY_JUPITER_INTEL,
  type JupiterTokenIntel,
} from "./jupiter-token";
export { parseHeliusEnhancedTx, isQuoteMint, USDT } from "./helius-swap";
export { tradesAsOf } from "./replay";
export { DurableWalletHistoryProvider, HistoryStoreError, type DurableHistoryOptions } from "./durable-history";
export { ReadOnlyRpcReader, interpretRpcTransaction, isTransactionSignature, MAINNET_GENESIS, type SignatureRow, type RpcInterpretation } from "./rpc-reader";
export { boundedInteger, SafeHttpError } from "./http";
export {
  normalizeParsedEventsItem,
  normalizeEnhancedTx,
  normalizeStreamMessage,
  classifyWalletActivity,
  dedupeTrades,
  parseParsedEventsItem,
  compareNormalized,
} from "./normalize";
