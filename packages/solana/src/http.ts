/** Bounded JSON transport shared by Helius history and other read-only RPC calls. */
export interface HttpOptions {
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}

export type HttpFailure = "network" | "timeout" | "http" | "malformed-json" | "oversized" | "aborted" | "invalid-options";

export class SafeHttpError extends Error {
  constructor(
    readonly kind: HttpFailure,
    readonly status: number | null,
    readonly retries: number,
  ) {
    super(kind === "http" ? `HTTP ${status ?? 0}` : kind);
    this.name = "SafeHttpError";
  }
}

export interface JsonResponse {
  value: unknown;
  status: number;
  retries: number;
  latencyMs: number;
}

function retryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < minimum || n > maximum) throw new SafeHttpError("invalid-options", null, 0);
  return n;
}

function retryDelay(retryAfter: string | null, attempt: number, base: number, cap: number): number {
  let requested = NaN;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    requested = Number.isFinite(seconds) && seconds >= 0
      ? seconds * 1000
      : Date.parse(retryAfter) - Date.now();
  }
  const exp = Math.min(cap, base * 2 ** attempt);
  return Math.min(cap, Math.max(0, Number.isFinite(requested) ? requested : exp * (0.5 + Math.random() * 0.5)));
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new SafeHttpError("aborted", null, 0));
    const timer = setTimeout(done, ms);
    function done() { signal?.removeEventListener("abort", abort); resolve(); }
    function abort() { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(new SafeHttpError("aborted", null, 0)); }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function boundedBody(response: Response, limit: number, signal: AbortSignal): Promise<string> {
  const claimed = Number(response.headers.get("content-length"));
  if (Number.isFinite(claimed) && claimed > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new SafeHttpError("oversized", response.status, 0);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > limit) throw new SafeHttpError("oversized", response.status, 0);
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(joined); }
  catch { throw new SafeHttpError("malformed-json", response.status, 0); }
}

export async function requestJson(url: string, init: RequestInit = {}, options: HttpOptions = {}): Promise<JsonResponse> {
  const timeoutMs = boundedInteger(options.timeoutMs, 8_000, 1, 30_000);
  const maxResponseBytes = boundedInteger(options.maxResponseBytes, 2_000_000, 1, 8_000_000);
  const maxRetries = boundedInteger(options.maxRetries, 2, 0, 5);
  const baseDelayMs = boundedInteger(options.baseDelayMs, 250, 0, 5_000);
  const maxDelayMs = boundedInteger(options.maxDelayMs, 2_000, 0, 5_000);
  const fetchFn = options.fetchFn ?? fetch;
  const parentSignal = options.signal && init.signal
    ? AbortSignal.any([options.signal, init.signal])
    : options.signal ?? init.signal ?? undefined;
  let last: SafeHttpError | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (parentSignal?.aborted) throw new SafeHttpError("aborted", null, attempt);
    const controller = new AbortController();
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutFailure = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new SafeHttpError("timeout", null, attempt));
      }, timeoutMs);
    });
    let abortReject: ((reason: SafeHttpError) => void) | undefined;
    const abortFailure = new Promise<never>((_, reject) => { abortReject = reject; });
    const abort = () => {
      controller.abort();
      abortReject?.(new SafeHttpError("aborted", null, attempt));
    };
    parentSignal?.addEventListener("abort", abort, { once: true });
    if (parentSignal?.aborted) abort();
    const started = Date.now();
    let retryAfter: string | null = null;
    try {
      const operation = async (): Promise<JsonResponse> => {
        const response = await fetchFn(url, { ...init, signal: controller.signal });
        retryAfter = response.headers.get("retry-after");
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          throw new SafeHttpError("http", response.status, attempt);
        }
        const body = await boundedBody(response, maxResponseBytes, controller.signal);
        let value: unknown;
        try { value = JSON.parse(body) as unknown; }
        catch { throw new SafeHttpError("malformed-json", response.status, attempt); }
        return { value, status: response.status, retries: attempt, latencyMs: Date.now() - started };
      };
      return await Promise.race([operation(), timeoutFailure, abortFailure]);
    } catch (error) {
      if (parentSignal?.aborted) throw new SafeHttpError("aborted", null, attempt);
      last = timedOut
        ? new SafeHttpError("timeout", null, attempt)
        : error instanceof SafeHttpError
          ? new SafeHttpError(error.kind, error.status, attempt)
          : new SafeHttpError("network", null, attempt);
      if (attempt === maxRetries || !(last.kind === "network" || last.kind === "timeout" ||
        (last.kind === "http" && retryable(last.status ?? 0)))) throw last;
    } finally {
      if (timeout) clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abort);
    }
    await delay(retryDelay(retryAfter, attempt, baseDelayMs, maxDelayMs), parentSignal);
  }
  throw last ?? new SafeHttpError("network", null, maxRetries);
}
