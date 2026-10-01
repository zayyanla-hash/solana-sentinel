import { formatAge, formatTime } from "./format";
import type { Destination, MonitorHealth, WalletHealth } from "./types";

export type Tone = "ok" | "warn" | "bad" | "neutral" | "pending";
export type Presented = { tone: Tone; label: string; detail?: string };

/** Mirrors the freshness gate used by the monitor route. */
export const STALE_POLL_MS = 120_000;

export function presentMonitor(status: string | null | undefined, error?: string | null): Presented {
  if (error) return { tone: "bad", label: "Monitor unavailable", detail: error };
  switch (status) {
    case "HEALTHY":
      return { tone: "ok", label: "Monitoring current", detail: "All watched wallets polled within 2 min" };
    case "DEGRADED":
      return { tone: "warn", label: "Monitoring degraded", detail: "Check wallet freshness, worker, storage and pending alerts" };
    case "WAITING_FOR_WALLETS":
      return { tone: "neutral", label: "No wallets yet", detail: "Add a wallet to start monitoring" };
    case "NOT_CONFIGURED":
      return { tone: "neutral", label: "Monitor not configured", detail: "Journal history source is not enabled on the host" };
    case null:
    case undefined:
      return { tone: "pending", label: "Checking monitor" };
    default:
      return { tone: "neutral", label: `Monitor: ${status}` };
  }
}

export function presentWorker(worker: MonitorHealth["worker"]): Presented {
  if (!worker) return { tone: "neutral", label: "Worker status unknown" };
  switch (worker.status) {
    case "healthy":
      return { tone: "ok", label: "Worker running", detail: `Heartbeat ${formatAge(worker.ageMs)} ago` };
    case "NO_HEARTBEAT":
      return { tone: "bad", label: "No worker heartbeat", detail: "Worker not started or not reporting" };
    case "STALE":
      return { tone: "warn", label: "Worker heartbeat stale", detail: `Last seen ${formatAge(worker.ageMs)} ago` };
    default:
      return { tone: "warn", label: `Worker: ${worker.status}` };
  }
}

export function presentStorage(storage: MonitorHealth["storage"]): Presented {
  const free = typeof storage?.availableBytes === "number" && Number.isFinite(storage.availableBytes) && storage.availableBytes >= 0
    ? `${(storage.availableBytes / 1024 ** 3).toFixed(1)} GiB free` : undefined;
  if (storage?.status === "OK" && free) return { tone: "ok", label: free };
  if (storage?.status === "LOW") return { tone: "warn", label: "Disk space low", detail: free };
  return { tone: "warn", label: "Disk space unknown", detail: "Check available space on the host Mac" };
}

export function presentBackup(
  entry: { status: string; lastSuccessAt?: string | null } | undefined,
  kind: "backup" | "copy",
): Presented {
  const noun = kind === "backup" ? "Backup" : "Off-host copy";
  const detail = entry?.lastSuccessAt ? `Last success ${formatTime(entry.lastSuccessAt)}` : undefined;
  switch (entry?.status) {
    case "VERIFIED":
      return { tone: "ok", label: `${noun} verified`, detail };
    case "OVERDUE":
      return { tone: "warn", label: `${noun} overdue`, detail };
    case "FAILED":
      return { tone: "bad", label: `${noun} failed`, detail };
    case "DATABASE_ONLY":
      return { tone: "warn", label: `${noun} database only`, detail: "Create a new backup including the configuration recovery key" };
    case "NOT_CONFIGURED":
      return { tone: "neutral", label: kind === "backup" ? "Backups not configured" : "Off-host copy not configured" };
    case undefined:
      return { tone: "neutral", label: `${noun} status unknown` };
    default:
      return { tone: "neutral", label: `${noun}: ${entry?.status}` };
  }
}

export function presentRpc(configured: boolean): Presented {
  return configured
    ? { tone: "ok", label: "RPC connected", detail: "Saved and verified at setup. Live capacity is reflected in monitor status." }
    : { tone: "warn", label: "RPC not configured", detail: "A dedicated HTTPS RPC endpoint is required." };
}

export function presentTelegram(configured: boolean): Presented {
  return configured ? { tone: "ok", label: "Bot saved" } : { tone: "neutral", label: "No bot" };
}

export function presentDestination(destination: Destination | null | undefined): Presented {
  if (!destination?.verified) return { tone: "neutral", label: "Not verified" };
  return destination.enabled
    ? { tone: "ok", label: "Verified" }
    : { tone: "warn", label: "Alerts paused", detail: "Verified, but delivery is switched off" };
}

export function presentWallet(health: WalletHealth | undefined): Presented {
  if (health?.lastError) return { tone: "bad", label: "Error", detail: health.lastError };
  if (!health || health.pollAgeMs === null || health.pollAgeMs === undefined) {
    return { tone: "pending", label: "Waiting for first poll" };
  }
  const age = formatAge(health.pollAgeMs);
  if (health.pollAgeMs > STALE_POLL_MS) return { tone: "warn", label: `Stale · ${age}` };
  switch (health.coverage) {
    case "CURRENT":
      return { tone: "ok", label: `Current · ${age}` };
    case "CATCHING_UP":
    case "BOOTSTRAP_WINDOW":
    case "HISTORICAL":
      return { tone: "warn", label: "Catching up", detail: "Backfilling a bounded recent window" };
    default:
      return { tone: "warn", label: "Coverage unknown", detail: health.coverage };
  }
}

export function presentDelivery(status: string): Presented {
  switch (status) {
    case "SENT":
      return { tone: "ok", label: "Sent" };
    case "DELIVERED":
      return { tone: "ok", label: "Delivered" };
    case "PENDING":
      return { tone: "pending", label: "Pending" };
    case "QUEUED":
      return { tone: "pending", label: "Queued" };
    case "SENDING":
      return { tone: "pending", label: "Sending" };
    case "RETRYING":
      return { tone: "pending", label: "Retrying" };
    case "FAILED":
      return { tone: "bad", label: "Failed" };
    case "UNCERTAIN":
      return { tone: "warn", label: "May have arrived", detail: "The send outcome is unknown" };
    default:
      return { tone: "neutral", label: status };
  }
}

export function presentActivityOutcome(outcome: string): Presented {
  switch (outcome) {
    case "OK":
    case "TRADE":
      return { tone: "ok", label: "Trade" };
    case "CLASSIFIED":
      return { tone: "ok", label: "Classified" };
    case "FAILED":
      return { tone: "bad", label: "Failed", detail: "The transaction failed on chain" };
    case "UNKNOWN":
      return { tone: "neutral", label: "Unclassified", detail: "Not proof of no trade" };
    default:
      return { tone: "neutral", label: outcome };
  }
}

export function presentAuditOutcome(outcome: string): Presented {
  switch (outcome) {
    case "completed":
      return { tone: "ok", label: "Completed" };
    case "failed":
      return { tone: "bad", label: "Failed" };
    case "requested":
      return { tone: "warn", label: "Incomplete", detail: "Incomplete — may have been interrupted" };
    default:
      return { tone: "neutral", label: outcome };
  }
}

/** "verify-destination" -> "Verify destination". */
export function humanizeAction(action: string): string {
  const text = action.replace(/[-_]+/g, " ").trim().replace(/\brpc\b/gi, "RPC");
  return text ? text[0]!.toUpperCase() + text.slice(1) : "Unknown action";
}

type AuditLike = { username: string; action: string; outcome: string; created_at: string };

/**
 * The server records "requested" before every change and "completed"/"failed" afterwards.
 * Hide a request once its resolution exists, so only genuinely unresolved requests read as
 * "Incomplete". Input and output are newest first.
 */
export function collapseAudit<T extends AuditLike>(entries: T[]): T[] {
  const oldestFirst = [...entries].reverse();
  const dropped = new Set<T>();
  const used = new Set<T>();
  oldestFirst.forEach((entry, index) => {
    if (entry.outcome !== "requested") return;
    const match = oldestFirst.slice(index + 1).find((later) =>
      !used.has(later) && later.outcome !== "requested" && later.username === entry.username && later.action === entry.action);
    if (match) { used.add(match); dropped.add(entry); }
  });
  return entries.filter((entry) => !dropped.has(entry));
}

const ERRORS: Record<string, string> = {
  DEDICATED_HTTPS_RPC_REQUIRED:
    "Use a dedicated HTTPS RPC endpoint. The public mainnet-beta endpoint and URLs with credentials in user:pass form are not accepted.",
  RPC_PROBE_NEEDS_ACTIVE_WALLET: "That wallet has no recent transactions to test with. Use an active public wallet.",
  CANNOT_REVOKE_CURRENT_MEMBER: "You cannot revoke your own access.",
  TELEGRAM_NOT_CONFIGURED: "Save a Telegram bot token first.",
  TELEGRAM_VERIFICATION_SEND_FAILED:
    "Telegram did not accept the verification message. Check the chat ID and that you started the bot.",
  VERIFIED_DESTINATION_REQUIRED: "Verify your Telegram destination before sending a test.",
  TELEGRAM_TEST_FAILED: "Telegram did not accept the test message.",
  LOGIN_RATE_LIMITED: "Too many attempts — wait a minute.",
  REQUEST_TOO_LARGE: "That request was too large.",
  INVALID_REQUEST: "The request was not valid.",
  TEAM_MEMBER_LIMIT:
    "The workspace is limited to two members. Enter an existing username to rotate that member's credential.",
  MONITOR_ONLY: "That action is unavailable in the shared monitor.",
  MONITOR_STORAGE_UNAVAILABLE: "Monitor storage unavailable",
};

/** Map an API error code (or the server's spaced message) to a human sentence; fall back to the server message. */
export function describeError(code: string | null | undefined, fallback?: string): string {
  const normalized = (code ?? fallback ?? "").trim().replace(/\s+/g, "_");
  return ERRORS[normalized] ?? (fallback || "Request failed");
}

export type SetupKey = "rpc" | "telegram" | "destination" | "wallet";
export type SetupStep = { key: SetupKey; label: string; done: boolean };

export function setupSteps(input: {
  rpcConfigured: boolean;
  telegramConfigured: boolean;
  destination: Destination | null | undefined;
  walletCount: number;
}): SetupStep[] {
  return [
    { key: "rpc", label: "RPC endpoint verified", done: input.rpcConfigured },
    { key: "telegram", label: "Telegram bot saved", done: input.telegramConfigured },
    { key: "destination", label: "Your destination verified", done: Boolean(input.destination?.verified) },
    { key: "wallet", label: "At least one wallet watched", done: input.walletCount > 0 },
  ];
}
