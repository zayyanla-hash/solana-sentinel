import { dayKey, formatAge, formatDayLabel, formatTime, shortAddress } from "./format";
import { STALE_POLL_MS, type Presented, type Tone } from "./status";
import type { MonitorHealth, Observation, Rule, StepKey, TeamStatus, View, WalletHealth } from "./types";

/* ---------- Wallet freshness ---------- */

/** CURRENT coverage, polled within the freshness gate, and no recorded error. */
export function isWalletCurrent(health: WalletHealth | undefined): boolean {
  if (!health || health.lastError) return false;
  if (health.coverage !== "CURRENT") return false;
  return health.pollAgeMs !== null && health.pollAgeMs !== undefined && health.pollAgeMs >= 0 && health.pollAgeMs <= STALE_POLL_MS;
}

export function countCurrent(addresses: string[], wallets: WalletHealth[] | undefined): { current: number; total: number } {
  const byWallet = new Map((wallets ?? []).map((w) => [w.wallet, w]));
  return { current: addresses.filter((a) => isWalletCurrent(byWallet.get(a))).length, total: addresses.length };
}

/** Why one wallet is not current, as a sentence fragment that follows the short address. */
export function walletReason(health: WalletHealth | undefined): string {
  if (!health) return "is waiting for its first poll";
  if (health.lastError) return `reported an error: ${health.lastError}`;
  if (health.pollAgeMs === null || health.pollAgeMs === undefined) return "is waiting for its first poll";
  if (health.pollAgeMs > STALE_POLL_MS) return `has not been polled for ${formatAge(health.pollAgeMs)}`;
  switch (health.coverage) {
    case "CURRENT":
      return "is current";
    case "CATCHING_UP":
    case "BOOTSTRAP_WINDOW":
    case "HISTORICAL":
      return "is still backfilling its recent window";
    default:
      return `has unknown coverage (${health.coverage})`;
  }
}

/* ---------- Home hero ---------- */

export type Hero = { headline: string; status: Presented; reason?: string };

export function heroSummary(input: {
  monitor: MonitorHealth | null;
  monitorError?: string | null;
  addresses: string[];
}): Hero {
  const { monitor, monitorError, addresses } = input;
  if (!monitor) {
    if (monitorError) return { headline: "Monitor unavailable", status: { tone: "bad", label: "Monitor unavailable" }, reason: monitorError };
    return { headline: "Checking monitor", status: { tone: "pending", label: "Checking monitor" } };
  }
  if (monitor.status === "NOT_CONFIGURED") {
    return {
      headline: "Monitor not configured",
      status: { tone: "neutral", label: "Monitor not configured" },
      reason: "The journal history source is not enabled on the host.",
    };
  }
  if (monitor.status === "WAITING_FOR_WALLETS" || addresses.length === 0) {
    return { headline: "No wallets yet", status: { tone: "neutral", label: "Waiting for wallets" }, reason: "Add a wallet to start monitoring." };
  }
  const { current, total } = countCurrent(addresses, monitor.wallets);
  const headline = `${current} of ${total} wallet${total === 1 ? "" : "s"} current`;
  const byWallet = new Map(monitor.wallets.map((w) => [w.wallet, w]));
  const lagging = addresses.filter((a) => !isWalletCurrent(byWallet.get(a)));
  const reasons: string[] = [];
  if (lagging.length) {
    const first = lagging[0]!;
    reasons.push(`${shortAddress(first)} ${walletReason(byWallet.get(first))}${lagging.length > 1 ? ` (and ${lagging.length - 1} more)` : ""}`);
  } else {
    if (monitor.worker && monitor.worker.status !== "healthy") reasons.push("the worker is not reporting a healthy heartbeat");
    const pending = monitor.stats?.pendingAlerts ?? 0;
    if (pending > 0) reasons.push(`${pending} alert${pending === 1 ? " is" : "s are"} waiting to be sent`);
  }
  switch (monitor.status) {
    case "HEALTHY":
      return { headline, status: { tone: "ok", label: "Monitoring current" }, reason: "All watched wallets polled within 2 minutes." };
    case "DEGRADED":
      return {
        headline,
        status: { tone: "warn", label: "Monitoring degraded" },
        reason: reasons.length ? reasons.join("; ").replace(/^./, (c) => c.toUpperCase()) + "." : undefined,
      };
    default:
      return { headline, status: { tone: "neutral", label: `Monitor: ${monitor.status}` } };
  }
}

/* ---------- Needs attention ---------- */

export type AttentionIcon = "alert" | "wallet" | "bell" | "gear";
export type AttentionItem = {
  key: string;
  tone: Extract<Tone, "warn" | "bad" | "neutral">;
  icon: AttentionIcon;
  title: string;
  body: string;
  action: string;
  view: View;
  wallet?: string;
  step?: StepKey;
};

const severity: Record<AttentionItem["tone"], number> = { bad: 0, warn: 1, neutral: 2 };
const MAX_WALLET_CARDS = 3;

export function needsAttention(input: {
  monitor: MonitorHealth | null;
  monitorError?: string | null;
  team: TeamStatus;
  addresses: string[];
}): AttentionItem[] {
  const { monitor, monitorError, team, addresses } = input;
  const items: AttentionItem[] = [];

  if (monitorError && !monitor) {
    items.push({ key: "monitor-error", tone: "bad", icon: "alert", title: "Monitor unavailable", body: `${monitorError}. Wallet status below may be out of date.`, action: "Open setup", view: "setup" });
  }
  if (monitor?.status === "NOT_CONFIGURED") {
    items.push({ key: "monitor-off", tone: "neutral", icon: "gear", title: "Monitor not configured", body: "The journal history source is not enabled on the host, so no wallet is being polled.", action: "How to fix", view: "setup" });
  }

  const copy = monitor?.backupCopy;
  if (copy) {
    const last = copy.lastSuccessAt ? `Last copy finished ${formatTime(copy.lastSuccessAt)}.` : "No successful copy is recorded.";
    if (copy.status === "OVERDUE") items.push({ key: "copy", tone: "warn", icon: "alert", title: "Off-host backup copy overdue", body: `${last} Run the copy on the host Mac.`, action: "How to fix", view: "setup" });
    else if (copy.status === "FAILED") items.push({ key: "copy", tone: "bad", icon: "alert", title: "Off-host backup copy failed", body: `${last} The last copy did not complete.`, action: "How to fix", view: "setup" });
    else if (copy.status === "NOT_CONFIGURED") items.push({ key: "copy", tone: "neutral", icon: "alert", title: "Off-host copy not configured", body: "Backups stay on the host Mac until an off-host copy is configured.", action: "How to fix", view: "setup" });
  }

  const backup = monitor?.backup;
  if (backup && backup.status !== "VERIFIED") {
    const last = backup.lastSuccessAt ? `Last verified ${formatTime(backup.lastSuccessAt)}.` : "No verified backup is recorded.";
    if (backup.status === "FAILED") items.push({ key: "backup", tone: "bad", icon: "alert", title: "Local backup failed", body: last, action: "How to fix", view: "setup" });
    else if (backup.status === "OVERDUE") items.push({ key: "backup", tone: "warn", icon: "alert", title: "Local backup overdue", body: last, action: "How to fix", view: "setup" });
    else if (backup.status === "NOT_CONFIGURED") items.push({ key: "backup", tone: "neutral", icon: "alert", title: "Local backups not configured", body: "No backup health is reported by the host.", action: "How to fix", view: "setup" });
    else items.push({ key: "backup", tone: "warn", icon: "alert", title: `Local backup: ${backup.status}`, body: last, action: "How to fix", view: "setup" });
  }

  const worker = monitor?.worker;
  if (worker && worker.status !== "healthy") {
    if (worker.status === "NO_HEARTBEAT") items.push({ key: "worker", tone: "bad", icon: "alert", title: "No worker heartbeat", body: "The worker is not started or not reporting, so nothing is being polled.", action: "How to fix", view: "setup" });
    else if (worker.status === "STALE") items.push({ key: "worker", tone: "warn", icon: "alert", title: "Worker heartbeat stale", body: `Last seen ${formatAge(worker.ageMs)} ago. The host may be asleep.`, action: "How to fix", view: "setup" });
    else items.push({ key: "worker", tone: "warn", icon: "alert", title: `Worker: ${worker.status}`, body: "The worker reported an unexpected state.", action: "How to fix", view: "setup" });
  }

  if (monitor && monitor.status !== "NOT_CONFIGURED") {
    const byWallet = new Map(monitor.wallets.map((w) => [w.wallet, w]));
    const lagging = addresses.filter((a) => !isWalletCurrent(byWallet.get(a)));
    for (const address of lagging.slice(0, MAX_WALLET_CARDS)) {
      const health = byWallet.get(address);
      const caught = health?.coverage === "CATCHING_UP" || health?.coverage === "BOOTSTRAP_WINDOW" || health?.coverage === "HISTORICAL";
      const title = health?.lastError ? `${shortAddress(address)} has an error` : !health || health.pollAgeMs == null ? `${shortAddress(address)} awaiting first poll`
        : health.pollAgeMs > STALE_POLL_MS ? `${shortAddress(address)} is stale` : caught ? `${shortAddress(address)} catching up` : `${shortAddress(address)} coverage unknown`;
      const body = health?.lastError ? health.lastError : caught && !health?.lastError && (health?.pollAgeMs ?? 0) <= STALE_POLL_MS
        ? "Backfilling a bounded recent window. Alerts start once its coverage is current." : `This wallet ${walletReason(health)}.`;
      items.push({ key: `wallet:${address}`, tone: health?.lastError ? "bad" : "warn", icon: "wallet", title, body, action: "View wallet", view: "wallets", wallet: address });
    }
    if (lagging.length > MAX_WALLET_CARDS) {
      items.push({ key: "wallets-more", tone: "warn", icon: "wallet", title: `${lagging.length - MAX_WALLET_CARDS} more wallets not current`, body: "Open the watchlist and filter by Needs attention to see each one.", action: "Open wallets", view: "wallets" });
    }
  }

  const uncertain = team.deliveries.filter((d) => d.status === "UNCERTAIN").length;
  const failed = team.deliveries.filter((d) => d.status === "FAILED").length;
  if (uncertain) items.push({ key: "uncertain", tone: "warn", icon: "bell", title: `${uncertain} Telegram send${uncertain === 1 ? "" : "s"} may have arrived`, body: "The outcome is unknown. Check Telegram before retrying to avoid a duplicate.", action: "Review delivery", view: "alerts" });
  if (failed) items.push({ key: "failed", tone: "bad", icon: "bell", title: `${failed} Telegram deliver${failed === 1 ? "y" : "ies"} failed`, body: "These alerts did not reach your chat. You can retry them.", action: "Review delivery", view: "alerts" });

  if (team.telegramConfigured) {
    if (!team.destination?.verified) items.push({ key: "destination", tone: "neutral", icon: "bell", title: "Your Telegram destination isn't verified", body: "Alerts reach Telegram only after you verify your own chat.", action: "Verify destination", view: "setup", step: "destination" });
    else if (!team.destination.enabled) items.push({ key: "paused", tone: "warn", icon: "bell", title: "Your Telegram alerts are paused", body: "Your destination is verified, but delivery is switched off.", action: "Open setup", view: "setup", step: "destination" });
  }
  if (!team.rpcConfigured) items.push({ key: "rpc", tone: "warn", icon: "gear", title: "Solana RPC not configured", body: "A dedicated HTTPS RPC endpoint is required before wallets can be polled.", action: "Open setup", view: "setup", step: "rpc" });
  if (!team.telegramConfigured) items.push({ key: "telegram", tone: "neutral", icon: "gear", title: "Telegram bot not saved", body: "Save the shared bot token so alerts can reach Telegram.", action: "Open setup", view: "setup", step: "telegram" });

  return items.map((item, index) => ({ item, index })).sort((a, b) => severity[a.item.tone] - severity[b.item.tone] || a.index - b.index).map(({ item }) => item);
}

/* ---------- System rows ---------- */

export type SystemRow = { key: string; label: string; value: string; tone: Tone };

export function systemRows(monitor: MonitorHealth | null, team: TeamStatus, now: number): SystemRow[] {
  const ago = (iso?: string | null) => (iso && Number.isFinite(Date.parse(iso)) ? formatAge(Math.max(0, now - Date.parse(iso))) : null);
  const worker = monitor?.worker;
  const backupRow = (key: string, label: string, entry: { status: string; lastSuccessAt?: string | null } | undefined): SystemRow => {
    const at = ago(entry?.lastSuccessAt);
    if (!entry) return { key, label, value: "unknown", tone: "neutral" };
    switch (entry.status) {
      case "VERIFIED": return { key, label, value: at ? `verified ${at} ago` : "verified", tone: "ok" };
      case "OVERDUE": return { key, label, value: at ? `${at} ago · overdue` : "overdue", tone: "warn" };
      case "FAILED": return { key, label, value: "last attempt failed", tone: "bad" };
      case "NOT_CONFIGURED": return { key, label, value: "not configured", tone: "neutral" };
      default: return { key, label, value: entry.status.toLowerCase(), tone: "neutral" };
    }
  };
  const destination = team.destination;
  return [
    !worker ? { key: "worker", label: "Worker heartbeat", value: "unknown", tone: "neutral" }
      : worker.status === "healthy" ? { key: "worker", label: "Worker heartbeat", value: `${formatAge(worker.ageMs)} ago`, tone: "ok" }
      : worker.status === "NO_HEARTBEAT" ? { key: "worker", label: "Worker heartbeat", value: "none", tone: "bad" }
      : { key: "worker", label: "Worker heartbeat", value: worker.status === "STALE" ? `stale · ${formatAge(worker.ageMs)}` : worker.status.toLowerCase(), tone: "warn" },
    backupRow("backup", "Local backup", monitor?.backup),
    backupRow("copy", "Off-host copy", monitor?.backupCopy),
    team.rpcConfigured ? { key: "rpc", label: "Solana RPC", value: "verified at setup", tone: "ok" } : { key: "rpc", label: "Solana RPC", value: "not configured", tone: "warn" },
    team.telegramConfigured ? { key: "bot", label: "Telegram bot", value: "saved", tone: "ok" } : { key: "bot", label: "Telegram bot", value: "not saved", tone: "neutral" },
    !destination?.verified ? { key: "destination", label: "Your destination", value: "not verified", tone: "neutral" }
      : destination.enabled ? { key: "destination", label: "Your destination", value: "verified · on", tone: "ok" }
      : { key: "destination", label: "Your destination", value: "verified · paused", tone: "warn" },
  ];
}

/* ---------- Grouping by day ---------- */

export type DayGroup<T> = { key: string; label: string; items: T[] };

/** Group consecutive items by local calendar day. Items without a block time form a "Recent" group. */
export function groupByDay<T extends Observation>(items: T[], now: Date = new Date()): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const entry of items) {
    const time = entry.item.blockTime;
    const hasTime = typeof time === "number" && Number.isFinite(time) && time > 0;
    const key = hasTime ? dayKey(new Date(time * 1000)) : "recent";
    const label = hasTime ? formatDayLabel(new Date(time * 1000), now) : "Recent";
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(entry);
    else groups.push({ key, label, items: [entry] });
  }
  return groups;
}

/* ---------- Wallet statistics ---------- */

export type WalletStats = { observations: number; buys: number; sells: number; legs: number; unclassified: number; failed: number; parserRevision: number | null };

export function walletStats(items: Observation[]): WalletStats {
  let buys = 0, sells = 0, unclassified = 0, failed = 0, revision = 0;
  for (const { item } of items) {
    for (const trade of item.trades) {
      if (trade.side === "BUY") buys += 1;
      else if (trade.side === "SELL") sells += 1;
    }
    if (item.outcome === "UNKNOWN") unclassified += 1;
    if (item.outcome === "FAILED") failed += 1;
    revision = Math.max(revision, item.parserVersion);
  }
  return { observations: items.length, buys, sells, legs: buys + sells, unclassified, failed, parserRevision: revision || null };
}

export function rulesForWallet(rules: Rule[], address: string): { rules: Rule[]; enabled: number } {
  const scoped = rules.filter((rule) => rule.wallet === address);
  return { rules: scoped, enabled: scoped.filter((rule) => rule.enabled).length };
}

/* ---------- Setup stepper ---------- */

export type StepState = "done" | "now" | "todo";
export type StepperItem = { key: StepKey; title: string; sub: string; state: StepState };

export function stepper(team: TeamStatus): StepperItem[] {
  const enabledMembers = team.members.filter((m) => m.enabled).length;
  const flags: Record<StepKey, boolean> = {
    rpc: team.rpcConfigured,
    telegram: team.telegramConfigured,
    destination: Boolean(team.destination?.verified),
    team: team.members.length >= 2 && enabledMembers >= 2,
  };
  const base: Omit<StepperItem, "state">[] = [
    { key: "rpc", title: "Solana connection", sub: flags.rpc ? "Dedicated HTTPS RPC verified" : "A dedicated HTTPS RPC endpoint is required" },
    { key: "telegram", title: "Shared Telegram bot", sub: flags.telegram ? "Token saved, never shown again" : "Save the bot token from BotFather" },
    { key: "destination", title: "Your Telegram destination", sub: flags.destination ? (team.destination?.enabled ? "Verified · alerts on" : "Verified · alerts paused") : "Each member verifies their own chat" },
    { key: "team", title: "Team access", sub: `${enabledMembers} of ${Math.max(2, team.members.length)} members active` },
  ];
  let marked = false;
  return base.map((step) => {
    if (flags[step.key]) return { ...step, state: "done" as const };
    if (!marked) { marked = true; return { ...step, state: "now" as const }; }
    return { ...step, state: "todo" as const };
  });
}
