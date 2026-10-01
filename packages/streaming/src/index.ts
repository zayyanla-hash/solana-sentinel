import { nowIso, newId, type HealthStatus } from "@sat/shared";

export interface ChainEvent {
  id: string;
  kind: "WALLET" | "TOKEN" | "PROGRAM" | "TRANSACTION";
  address: string;
  signature?: string;
  slot?: number;
  timestamp: string;
  payload: Record<string, unknown>;
  isDemo: boolean;
}

export interface StreamHealth {
  status: HealthStatus;
  connected: boolean;
  lastEventAt: string | null;
  reconnects: number;
  stale: boolean;
  reason?: string;
}

export interface OnChainStreamProvider {
  readonly name: string;
  readonly isDemo: boolean;
  subscribeWallet(address: string): Promise<void>;
  subscribeToken(mint: string): Promise<void>;
  subscribeProgram(programId: string): Promise<void>;
  subscribeTransactions(filter?: string): Promise<void>;
  onEvent(handler: (ev: ChainEvent) => void): () => void;
  health(): StreamHealth;
  close(): Promise<void>;
}

export interface HistoricalChainProvider {
  readonly name: string;
  readonly isDemo: boolean;
  walletHistory(address: string): Promise<ChainEvent[]>;
  tokenHolders(mint: string): Promise<Array<{ address: string; amount: string }>>;
  transactions(address: string, limit?: number): Promise<ChainEvent[]>;
}

function backoffMs(attempt: number): number {
  return Math.min(30_000, 500 * 2 ** Math.min(attempt, 6));
}

export class DemoStreamProvider implements OnChainStreamProvider, HistoricalChainProvider {
  readonly name = "demo-stream";
  readonly isDemo = true;
  private handlers = new Set<(ev: ChainEvent) => void>();
  private reconnects = 0;
  private lastEventAt: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cursor = 0;
  private closed = false;

  constructor(private readonly staleMs = 60_000) {}

  start(): void {
    if (this.timer || this.closed) return;
    this.timer = setInterval(() => this.tick(), 1_500);
  }

  private emit(ev: ChainEvent): void {
    this.lastEventAt = ev.timestamp;
    this.cursor += 1;
    for (const h of this.handlers) h(ev);
  }

  private tick(): void {
    if (this.closed) return;
    const ev: ChainEvent = {
      id: `demo-${this.cursor}`,
      kind: "TOKEN",
      address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
      timestamp: nowIso(),
      payload: { cursor: this.cursor, note: "DEMO stream heartbeat" },
      isDemo: true,
    };
    this.emit(ev);
  }

  async subscribeWallet(_address: string): Promise<void> {
    this.start();
  }
  async subscribeToken(_mint: string): Promise<void> {
    this.start();
  }
  async subscribeProgram(_programId: string): Promise<void> {
    this.start();
  }
  async subscribeTransactions(_filter?: string): Promise<void> {
    this.start();
  }

  onEvent(handler: (ev: ChainEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  health(): StreamHealth {
    const last = this.lastEventAt ? Date.parse(this.lastEventAt) : 0;
    const stale = last > 0 && Date.now() - last > this.staleMs;
    return {
      status: stale ? "degraded" : "demo_fallback",
      connected: !this.closed,
      lastEventAt: this.lastEventAt,
      reconnects: this.reconnects,
      stale,
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.handlers.clear();
  }

  async walletHistory(address: string): Promise<ChainEvent[]> {
    return [
      {
        id: newId(),
        kind: "WALLET",
        address,
        timestamp: nowIso(),
        payload: { note: "DEMO history" },
        isDemo: true,
      },
    ];
  }
  async tokenHolders(_mint: string) {
    return [];
  }
  async transactions(address: string, limit = 10): Promise<ChainEvent[]> {
    return (await this.walletHistory(address)).slice(0, limit);
  }
}

/**
 * Unimplemented Helius stream placeholder. Subscribe explicitly fails so no
 * caller can mistake injected fixtures for a live WebSocket connection.
 */
export class HeliusStreamProvider implements OnChainStreamProvider {
  readonly name = "helius-laserstream";
  readonly isDemo = false;
  private handlers = new Set<(ev: ChainEvent) => void>();
  private seen = new Set<string>();
  private reconnects = 0;
  private lastEventAt: string | null = null;
  private closed = false;

  constructor(
    _apiKey: string,
    _wsUrl = process.env.HELIUS_WS_URL,
  ) {}

  async subscribeWallet(_address: string): Promise<void> { throw new Error("helius-stream-not-implemented"); }
  async subscribeToken(_mint: string): Promise<void> { throw new Error("helius-stream-not-implemented"); }
  async subscribeProgram(_programId: string): Promise<void> { throw new Error("helius-stream-not-implemented"); }
  async subscribeTransactions(_filter?: string): Promise<void> { throw new Error("helius-stream-not-implemented"); }

  onEvent(handler: (ev: ChainEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  ingest(ev: ChainEvent): void {
    if (this.closed) return;
    const key = ev.signature ?? ev.id;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.seen.size > 4096) this.seen.delete(this.seen.values().next().value!);
    this.lastEventAt = ev.timestamp;
    for (const h of this.handlers) h(ev);
  }

  health(): StreamHealth {
    return {
      status: "unavailable",
      connected: false,
      lastEventAt: this.lastEventAt,
      reconnects: this.reconnects,
      stale: true,
      reason: "helius-stream-not-implemented",
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.handlers.clear();
    this.seen.clear();
  }
}

export function createStreamProvider(): OnChainStreamProvider {
  const key = process.env.HELIUS_API_KEY?.trim();
  if (key) return new HeliusStreamProvider(key);
  return new DemoStreamProvider();
}

export { backoffMs };
