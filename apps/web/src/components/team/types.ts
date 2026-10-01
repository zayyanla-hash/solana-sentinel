export type Member = { id: string; username: string; enabled: boolean };

export type Rule = {
  id: string;
  name: string;
  trigger: string;
  enabled: boolean;
  cooldownMinutes: number;
  wallet: string | null;
  mint: string | null;
};

export type Delivery = {
  id: string;
  eventId: string;
  status: string;
  attempts: number;
  lastError: string | null;
};

export type Destination = { verified: boolean; chatId: string | null; enabled: boolean };

export type AuditEntry = {
  id: string;
  username: string;
  action: string;
  outcome: string;
  created_at: string;
};

export type TeamStatus = {
  member: Member;
  members: Member[];
  rpcConfigured: boolean;
  telegramConfigured: boolean;
  destination: Destination | null;
  deliveries: Delivery[];
  audit: AuditEntry[];
};

export type AlertEvent = {
  id: string;
  title: string;
  body: string;
  delivered: boolean;
  suppressedReason: string | null;
  createdAt: string;
  isDemo: boolean;
};

export type StateSnapshot = {
  watchlist: { id: string; address: string; kind: string }[];
  alertRules: Rule[];
  alertEvents: AlertEvent[];
};

export type WalletHealth = {
  wallet: string;
  coverage: string;
  pollAgeMs: number | null;
  lastError: string | null;
  lastSuccessAt?: string | null;
};

export type MonitorHealth = {
  status: string;
  scope: string;
  observedAt: string;
  stats: {
    observations: number;
    trades: number;
    pendingAlerts: number;
    outcomes: { UNKNOWN: number; FAILED: number; CLASSIFIED?: number };
    archivedObservations?: number;
    observationCapacityPercent?: number;
  } | null;
  wallets: WalletHealth[];
  backup?: { status: string; lastSuccessAt?: string | null };
  backupCopy?: { status: string; lastSuccessAt?: string | null };
  worker?: { status: string; ageMs: number | null };
};

export type TradeLeg = { side: string; mint: string; qty: number };

export type ActivityItem = {
  signature: string;
  slot: number;
  blockTime?: number | null;
  outcome: string;
  reason: string;
  parserVersion: number;
  trades: TradeLeg[];
};

export type ActivityResponse = { wallet: string; activity: ActivityItem[]; scope?: string };

/** One activity item tied to the wallet it was observed on. */
export type Observation = { wallet: string; item: ActivityItem };

export type RpcResult = { ok: boolean; probeDurationMs?: number; scope?: string };

export type View = "home" | "wallets" | "alerts" | "setup";
export type StepKey = "rpc" | "telegram" | "destination" | "team";
/** Where a navigation lands inside a view. */
export type NavTarget = { wallet?: string; step?: StepKey; alertsTab?: "inbox" | "rules" };
export type Phase = "loading" | "signedOut" | "ready" | "unavailable";
export type SignOutReason = null | "expired" | "signedOut";
export type Notice = { tone: "success" | "error"; text: string; scope?: string };

/** Runs one mutation: tracks pending state, refreshes data and reports the outcome. */
export type Run = (
  key: string,
  action: () => Promise<unknown>,
  success?: string,
  scope?: string,
) => Promise<boolean>;
