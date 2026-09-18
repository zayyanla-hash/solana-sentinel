import {
  type ExecutionPlan,
  type ExecutionQuote,
  type ExecutionQuality,
  USDC,
  nowIso,
  assertNotLiveBroadcast,
  isLiveTradingAllowed,
  type OperatingMode,
  ExecutionPlanSchema,
  QuoteProviderError,
} from "@sat/shared";

export { QuoteProviderError };

export interface QuoteRequest {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps?: number;
}

export interface ExecutionProvider {
  readonly name: string;
  readonly isDemo: boolean;
  quote(params: QuoteRequest): Promise<ExecutionQuote>;
  plan(quote: ExecutionQuote, mode: OperatingMode): Promise<ExecutionPlan>;
}

export type QuoteProvider = ExecutionProvider;

const FORBIDDEN_JUPITER_PATHS = [
  "/execute",
  "/submit",
  "/swap/v2/execute",
  "/ultra/v1/execute",
  "/swap/v1/swap",
];

export function assertQuoteOnlyJupiterUrl(url: string): void {
  const lower = url.toLowerCase();
  for (const banned of FORBIDDEN_JUPITER_PATHS) {
    if (lower.includes(banned)) {
      throw new Error(`Forbidden Jupiter execution path: ${banned}`);
    }
  }
}

function qualityFromImpact(priceImpactPct: number | null): ExecutionQuality {
  if (priceImpactPct == null || !Number.isFinite(priceImpactPct)) return "UNKNOWN";
  if (priceImpactPct < 0.15) return "HIGH";
  if (priceImpactPct < 0.8) return "MEDIUM";
  return "LOW";
}

function labelsFromRoutePlan(raw: Record<string, unknown>): string[] {
  const plan = raw.routePlan;
  if (!Array.isArray(plan)) return [];
  return plan
    .map((step) => {
      if (!step || typeof step !== "object") return null;
      const info = (step as { swapInfo?: { label?: unknown } }).swapInfo;
      return typeof info?.label === "string" ? info.label : null;
    })
    .filter((x): x is string => Boolean(x));
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export class DemoExecutionProvider implements ExecutionProvider {
  readonly name = "demo-jupiter";
  readonly isDemo = true;

  async quote(params: QuoteRequest): Promise<ExecutionQuote> {
    const inAmount = params.amount;
    const outAmount = String(Math.floor(Number(inAmount) * 0.997));
    const quotedAt = nowIso();
    return {
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      inAmount,
      outAmount,
      otherAmountThreshold: String(Math.floor(Number(outAmount) * 0.99)),
      priceImpactPct: 0.12,
      slippageBps: params.slippageBps ?? 50,
      routeLabels: ["DEMO-ROUTE"],
      feeEstimateUsd: 0.05,
      provider: "demo",
      quotedAt,
      isDemo: true,
      router: "demo",
      priorityFeeLamports: 0,
      estimatedExecutionQuality: "UNKNOWN",
      dataAgeMs: 0,
      quoteTimestamp: quotedAt,
    };
  }

  async plan(quote: ExecutionQuote, mode: OperatingMode): Promise<ExecutionPlan> {
    assertNotLiveBroadcast(mode === "LIVE" ? "LIVE" : "PAPER");
    return ExecutionPlanSchema.parse({
      quote,
      mode: "PAPER",
      canBroadcast: false,
      notes: [
        "DEMO quote — not a live Jupiter response",
        "Broadcast disabled by safety gates",
        `Operating mode: ${mode}`,
        "Swap API V2 /execute is intentionally not implemented",
      ],
      plannedAt: nowIso(),
    });
  }
}

/**
 * Jupiter Swap API V2 GET /swap/v2/order — quote/route only.
 * Official docs: https://developers.jup.ag/docs/swap
 * Ultra /ultra/v1/order is superseded by this endpoint; we do not call /execute.
 * Fail-closed: never returns unlabeled demo data on provider failure.
 */
export class JupiterSwapV2Provider implements ExecutionProvider {
  readonly name = "jupiter-swap-v2";
  readonly isDemo = false;

  constructor(
    private readonly apiBase = process.env.JUPITER_API_BASE ?? "https://api.jup.ag/swap/v2",
    private readonly apiKey = process.env.JUPITER_API_KEY,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { Accept: "application/json" };
    if (this.apiKey) h["x-api-key"] = this.apiKey;
    return h;
  }

  async quote(params: QuoteRequest): Promise<ExecutionQuote> {
    const slippageBps = params.slippageBps ?? 50;
    const base = this.apiBase.replace(/\/$/, "");
    const url = `${base}/order`;
    assertQuoteOnlyJupiterUrl(url);
    const qs = new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      slippageBps: String(slippageBps),
    });
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(`${url}?${qs}`, { headers: this.headers() });
    } catch (err) {
      throw new QuoteProviderError(
        this.name,
        `Jupiter Swap V2 network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!res.ok) {
      throw new QuoteProviderError(this.name, `Jupiter Swap V2 HTTP ${res.status}`);
    }
    const raw = (await res.json()) as Record<string, unknown>;
    const outAmount = String(raw.outAmount ?? "");
    if (!outAmount) {
      throw new QuoteProviderError(this.name, "Jupiter Swap V2 quote missing outAmount");
    }
    const priceImpactPct =
      numOrNull(raw.priceImpactPct) ?? numOrNull(raw.priceImpact);
    const quotedAt = nowIso();
    const router =
      typeof raw.router === "string"
        ? raw.router
        : typeof raw.swapType === "string"
          ? raw.swapType
          : null;
    const priority =
      numOrNull(raw.prioritizationFeeLamports) ??
      numOrNull((raw.prioritizationFee as { lamports?: unknown } | undefined)?.lamports);
    return {
      inputMint: String(raw.inputMint ?? params.inputMint),
      outputMint: String(raw.outputMint ?? params.outputMint),
      inAmount: String(raw.inAmount ?? params.amount),
      outAmount,
      otherAmountThreshold:
        raw.otherAmountThreshold != null ? String(raw.otherAmountThreshold) : undefined,
      priceImpactPct,
      slippageBps: typeof raw.slippageBps === "number" ? raw.slippageBps : slippageBps,
      routeLabels: labelsFromRoutePlan(raw),
      feeEstimateUsd: numOrNull(raw.platformFee) ?? numOrNull(raw.feeBps),
      provider: "jupiter-swap-v2",
      raw: {
        ...raw,
        transaction: undefined,
        requestId: undefined,
      },
      quotedAt,
      isDemo: false,
      router,
      priorityFeeLamports: priority,
      estimatedExecutionQuality: qualityFromImpact(priceImpactPct),
      dataAgeMs: Date.now() - started,
      quoteTimestamp: quotedAt,
    };
  }

  async plan(quote: ExecutionQuote, mode: OperatingMode): Promise<ExecutionPlan> {
    assertNotLiveBroadcast(mode === "LIVE" ? "LIVE" : "PAPER");
    const notes = quote.isDemo
      ? [
          "DEMO quote — not a live Jupiter response",
          "Broadcast disabled by safety gates",
          `Operating mode: ${mode}`,
        ]
      : [
          "Jupiter Swap API V2 GET /order quote/route only — /execute is not implemented",
          "Ultra is superseded by Swap V2 /order; Sentinel never broadcasts",
          `canBroadcast=false always; isLiveTradingAllowed=${isLiveTradingAllowed()}`,
          quote.router ? `router=${quote.router}` : "router=UNKNOWN",
          `quality=${quote.estimatedExecutionQuality ?? "UNKNOWN"}`,
        ];
    return ExecutionPlanSchema.parse({
      quote,
      mode: "PAPER",
      canBroadcast: false,
      notes,
      plannedAt: nowIso(),
    });
  }
}

/**
 * Deprecated Ultra path kept only for schema compatibility tests.
 * Official docs: Ultra Swap API is no longer actively maintained.
 * Sentinel does not use this provider by default.
 */
export class JupiterUltraLegacyProvider implements ExecutionProvider {
  readonly name = "jupiter-ultra-legacy";
  readonly isDemo = false;

  async quote(_params: QuoteRequest): Promise<ExecutionQuote> {
    throw new QuoteProviderError(
      this.name,
      "Ultra Swap API is superseded by Swap API V2 GET /swap/v2/order. Refusing deprecated Ultra calls.",
    );
  }

  async plan(quote: ExecutionQuote, mode: OperatingMode): Promise<ExecutionPlan> {
    return new JupiterSwapV2Provider().plan(quote, mode);
  }
}

/** @deprecated Use JupiterSwapV2Provider. Kept as a type-compatible alias. */
export class JupiterExecutionProvider extends JupiterSwapV2Provider {
  constructor(apiBase?: string, apiKey?: string) {
    super(apiBase, apiKey);
  }
}

export function createExecutionProvider(): ExecutionProvider {
  const key = process.env.JUPITER_API_KEY?.trim();
  if (key) return new JupiterSwapV2Provider();
  return new DemoExecutionProvider();
}

export { USDC };
