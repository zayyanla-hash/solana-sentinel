import { z } from "zod";
import { SolanaAddressSchema } from "./schemas";

export const ChainProviderNameSchema = z.enum([
  "helius-parsed-events",
  "helius-enhanced-tx",
  "helius-parsed-stream",
  "fixture",
  "demo",
]);
export type ChainProviderName = z.infer<typeof ChainProviderNameSchema>;

export const ChainTxStatusSchema = z.enum(["OK", "FAILED", "UNKNOWN"]);
export type ChainTxStatus = z.infer<typeof ChainTxStatusSchema>;

export const AssetDeltaSchema = z.object({
  mint: SolanaAddressSchema,
  qty: z.number(),
  raw: z.string().nullable(),
  decimals: z.number().int().nullable(),
  from: z.string().nullable(),
  to: z.string().nullable(),
});
export type AssetDelta = z.infer<typeof AssetDeltaSchema>;

export const SwapHintSchema = z.object({
  inputMint: SolanaAddressSchema,
  outputMint: SolanaAddressSchema,
  inAmount: z.number().nullable(),
  outAmount: z.number().nullable(),
  protocol: z.string().nullable(),
  innerMints: z.array(SolanaAddressSchema).default([]),
});
export type SwapHint = z.infer<typeof SwapHintSchema>;

export const NormalizedChainEventSchema = z.object({
  signature: z.string().min(1).max(128),
  slot: z.number().int().nullable(),
  blockTime: z.number().int().nullable(),
  wallet: SolanaAddressSchema.nullable(),
  status: ChainTxStatusSchema,
  feeLamports: z.number().nonnegative().nullable(),
  feePayer: z.string().nullable(),
  programs: z.array(z.string()),
  summaryType: z.string().nullable(),
  nativeDeltas: z.array(
    z.object({
      from: z.string().nullable(),
      to: z.string().nullable(),
      amountLamports: z.number(),
    }),
  ),
  tokenDeltas: z.array(AssetDeltaSchema),
  swapHint: SwapHintSchema.nullable(),
  provider: ChainProviderNameSchema,
  parserStatus: z.enum(["OK", "ERROR", "RAW"]),
  warnings: z.array(z.string()),
});
export type NormalizedChainEvent = z.infer<typeof NormalizedChainEventSchema>;

export const PriceProvenanceSchema = z.object({
  source: z.string(),
  timestamp: z.string().datetime().nullable(),
  mint: SolanaAddressSchema,
  quote: z.literal("USD"),
  kind: z.enum(["HISTORICAL", "CURRENT", "UNKNOWN"]),
  ok: z.boolean(),
});
export type PriceProvenance = z.infer<typeof PriceProvenanceSchema>;
