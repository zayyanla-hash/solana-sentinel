import { describe, expect, it } from "vitest";
import {
  collapseAudit, describeError, humanizeAction, presentActivityOutcome, presentAuditOutcome, presentBackup, presentDelivery,
  presentDestination, presentMonitor, presentRpc, presentTelegram, presentWallet, presentWorker, setupSteps,
} from "../apps/web/src/components/team/status";
import { formatAge, formatClock, formatQty, formatTime, isBase58Address, shortAddress } from "../apps/web/src/components/team/format";

describe("team dashboard status presenters", () => {
  it("maps monitor status and never shows a fetch error as healthy", () => {
    expect(presentMonitor("HEALTHY")).toMatchObject({ tone: "ok", label: "Monitoring current" });
    expect(presentMonitor("DEGRADED").tone).toBe("warn");
    expect(presentMonitor("WAITING_FOR_WALLETS")).toMatchObject({ tone: "neutral", label: "No wallets yet" });
    expect(presentMonitor("NOT_CONFIGURED")).toMatchObject({ tone: "neutral", label: "Monitor not configured" });
    expect(presentMonitor("HEALTHY", "Monitor storage unavailable")).toMatchObject({ tone: "bad", label: "Monitor unavailable", detail: "Monitor storage unavailable" });
    expect(presentMonitor("SOMETHING_NEW")).toMatchObject({ tone: "neutral", label: "Monitor: SOMETHING_NEW" });
    expect(presentMonitor(undefined).tone).toBe("pending");
  });

  it("maps worker heartbeat states", () => {
    expect(presentWorker({ status: "healthy", ageMs: 12_000 })).toMatchObject({ tone: "ok", detail: "Heartbeat 12s ago" });
    expect(presentWorker({ status: "NO_HEARTBEAT", ageMs: null }).tone).toBe("bad");
    expect(presentWorker({ status: "STALE", ageMs: 300_000 })).toMatchObject({ tone: "warn", detail: "Last seen 5m ago" });
    expect(presentWorker({ status: "UNKNOWN", ageMs: 1000 })).toMatchObject({ tone: "warn", label: "Worker: UNKNOWN" });
    expect(presentWorker(undefined).tone).toBe("neutral");
  });

  it("distinguishes backup and off-host copy states", () => {
    expect(presentBackup({ status: "VERIFIED" }, "backup")).toMatchObject({ tone: "ok", label: "Backup verified" });
    expect(presentBackup({ status: "OVERDUE" }, "backup").tone).toBe("warn");
    expect(presentBackup({ status: "FAILED" }, "copy")).toMatchObject({ tone: "bad", label: "Off-host copy failed" });
    expect(presentBackup({ status: "NOT_CONFIGURED" }, "backup")).toMatchObject({ tone: "neutral", label: "Backups not configured" });
    expect(presentBackup({ status: "NOT_CONFIGURED" }, "copy").label).toBe("Off-host copy not configured");
    expect(presentBackup({ status: "ODD" }, "copy")).toMatchObject({ tone: "neutral", label: "Off-host copy: ODD" });
  });

  it("presents configuration flags and destination", () => {
    expect(presentRpc(true).tone).toBe("ok");
    expect(presentRpc(false)).toMatchObject({ tone: "warn", label: "RPC not configured" });
    expect(presentTelegram(true).label).toBe("Bot saved");
    expect(presentTelegram(false).label).toBe("No bot");
    expect(presentDestination(null).label).toBe("Not verified");
    expect(presentDestination({ verified: true, chatId: "1", enabled: false })).toMatchObject({ tone: "warn", label: "Alerts paused" });
    expect(presentDestination({ verified: true, chatId: "1", enabled: true }).tone).toBe("ok");
  });

  it("classifies wallet coverage by error, absence, staleness and coverage", () => {
    const base = { wallet: "w", coverage: "CURRENT", pollAgeMs: 12_000, lastError: null };
    expect(presentWallet({ ...base, lastError: "RPC timeout" })).toMatchObject({ tone: "bad", label: "Error", detail: "RPC timeout" });
    expect(presentWallet(undefined)).toMatchObject({ tone: "pending", label: "Waiting for first poll" });
    expect(presentWallet({ ...base, pollAgeMs: null }).tone).toBe("pending");
    expect(presentWallet({ ...base, pollAgeMs: 240_000 })).toMatchObject({ tone: "warn", label: "Stale · 4m" });
    expect(presentWallet({ ...base, pollAgeMs: 120_000 })).toMatchObject({ tone: "ok" });
    expect(presentWallet(base)).toMatchObject({ tone: "ok", label: "Current · 12s" });
    expect(presentWallet({ ...base, coverage: "CATCHING_UP" })).toMatchObject({ tone: "warn", label: "Catching up" });
    expect(presentWallet({ ...base, coverage: "MYSTERY" })).toMatchObject({ tone: "warn", label: "Coverage unknown" });
  });

  it("treats uncertain deliveries as maybe-delivered and keeps unknown raw values visible", () => {
    expect(presentDelivery("SENT").tone).toBe("ok");
    expect(presentDelivery("DELIVERED").tone).toBe("ok");
    expect(presentDelivery("PENDING").tone).toBe("pending");
    expect(presentDelivery("QUEUED").tone).toBe("pending");
    expect(presentDelivery("FAILED").tone).toBe("bad");
    expect(presentDelivery("UNCERTAIN")).toMatchObject({ tone: "warn", label: "May have arrived" });
    expect(presentDelivery("WEIRD")).toMatchObject({ tone: "neutral", label: "WEIRD" });
  });

  it("presents UNKNOWN activity as abstention, not absence of a trade", () => {
    expect(presentActivityOutcome("OK").tone).toBe("ok");
    expect(presentActivityOutcome("TRADE").tone).toBe("ok");
    expect(presentActivityOutcome("FAILED").tone).toBe("bad");
    expect(presentActivityOutcome("UNKNOWN")).toMatchObject({ tone: "neutral", label: "Unclassified", detail: "Not proof of no trade" });
    expect(presentActivityOutcome("NEW_KIND")).toMatchObject({ tone: "neutral", label: "NEW_KIND" });
  });

  it("marks an audit request without completion as incomplete", () => {
    expect(presentAuditOutcome("completed").tone).toBe("ok");
    expect(presentAuditOutcome("failed").tone).toBe("bad");
    expect(presentAuditOutcome("requested")).toMatchObject({ tone: "warn", detail: "Incomplete — may have been interrupted" });
    expect(presentAuditOutcome("other")).toMatchObject({ tone: "neutral", label: "other" });
  });

  it("humanizes actions and maps API error codes", () => {
    expect(humanizeAction("verify-destination")).toBe("Verify destination");
    expect(humanizeAction("rpc")).toBe("RPC");
    expect(humanizeAction("")).toBe("Unknown action");
    expect(describeError("DEDICATED_HTTPS_RPC_REQUIRED", "DEDICATED HTTPS RPC REQUIRED")).toMatch(/dedicated HTTPS RPC endpoint/);
    expect(describeError(undefined, "DEDICATED HTTPS RPC REQUIRED")).toMatch(/dedicated HTTPS RPC endpoint/);
    expect(describeError("LOGIN_RATE_LIMITED")).toBe("Too many attempts — wait a minute.");
    expect(describeError("TEAM_MEMBER_LIMIT")).toMatch(/limited to two members/);
    expect(describeError("UNKNOWN_CODE", "Server said no")).toBe("Server said no");
    expect(describeError(undefined)).toBe("Request failed");
  });

  it("hides requests that have a resolution and keeps unresolved ones", () => {
    const row = (id: string, outcome: string, action = "rule", username = "a") => ({ id, username, action, outcome, created_at: "2026-10-01T00:00:00Z" });
    // newest first: completed(2) <- requested(2), completed(1) <- requested(1), lone requested(0)
    const entries = [row("c2", "completed"), row("r2", "requested"), row("c1", "failed"), row("r1", "requested"), row("r0", "requested", "telegram")];
    expect(collapseAudit(entries).map((e) => e.id)).toEqual(["c2", "c1", "r0"]);
    expect(collapseAudit([row("r", "requested", "rule", "a"), row("c", "completed", "rule", "b")]).map((e) => e.id)).toEqual(["r", "c"]);
  });

  it("computes setup progress", () => {
    const steps = setupSteps({ rpcConfigured: true, telegramConfigured: false, destination: { verified: false, chatId: null, enabled: false }, walletCount: 0 });
    expect(steps.map((s) => s.done)).toEqual([true, false, false, false]);
    expect(setupSteps({ rpcConfigured: true, telegramConfigured: true, destination: { verified: true, chatId: "1", enabled: true }, walletCount: 2 }).every((s) => s.done)).toBe(true);
  });
});

describe("team dashboard formatting", () => {
  it("shortens addresses in the middle", () => {
    expect(shortAddress("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM")).toBe("9WzD…AWWM");
    expect(shortAddress("short")).toBe("short");
  });
  it("formats ages", () => {
    expect(formatAge(12_000)).toBe("12s");
    expect(formatAge(4 * 60_000 + 5000)).toBe("4m");
    expect(formatAge(3 * 3_600_000)).toBe("3h");
    expect(formatAge(2 * 86_400_000)).toBe("2d");
    expect(formatAge(null)).toBe("—");
    expect(formatAge(-5)).toBe("—");
    expect(formatAge(Number.NaN)).toBe("—");
  });
  it("formats times and rejects invalid input", () => {
    expect(formatTime("not a date")).toBe("—");
    expect(formatTime(null)).toBe("—");
    expect(formatTime("2026-10-01T12:34:56Z")).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(formatClock(0)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(formatClock("bad")).toBe("—");
  });
  it("formats quantities without USD", () => {
    expect(formatQty(1250.5)).toBe("1,250.5");
    expect(formatQty(0.000001234)).toBe("0.000001");
    expect(formatQty(Number.POSITIVE_INFINITY)).toBe("—");
  });
  it("pre-checks base58 address shape", () => {
    expect(isBase58Address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM")).toBe(true);
    expect(isBase58Address("too-short")).toBe(false);
    expect(isBase58Address("0".repeat(40))).toBe(false); // 0 is not in the base58 alphabet
    expect(isBase58Address(`${"1".repeat(44)}1`)).toBe(false);
  });
});

import { countCurrent, groupByDay, heroSummary, isWalletCurrent, needsAttention, rulesForWallet, stepper, systemRows, walletStats } from "../apps/web/src/components/team/derive";
import { inboxEvents, inboxSide } from "../apps/web/src/components/team/derive-alerts";
import { buildPoints, classify, isMarked, layoutChart, nearestIndex, sparklinePath } from "../apps/web/src/components/team/chart-data";
import { createScopedRule } from "../apps/web/src/components/team/rules";
import { HttpError } from "../apps/web/src/components/team/api";
import { addressProblem, formatCooldown, formatDayLabel, maskChatId } from "../apps/web/src/components/team/format";
import type { ActivityItem, MonitorHealth, Observation, TeamStatus } from "../apps/web/src/components/team/types";

const A = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const B = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const MINT = "So11111111111111111111111111111111111111112";
const item = (over: Partial<ActivityItem>): ActivityItem => ({ signature: "sig" + Math.random(), slot: 100, blockTime: 1000, outcome: "UNKNOWN", reason: "", parserVersion: 3, trades: [], ...over });
const obs = (wallet: string, over: Partial<ActivityItem>): Observation => ({ wallet, item: item(over) });
const monitor = (over: Partial<MonitorHealth> = {}): MonitorHealth => ({
  status: "HEALTHY", scope: "s", observedAt: "2026-10-01T00:00:00Z", stats: null,
  wallets: [{ wallet: A, coverage: "CURRENT", pollAgeMs: 5000, lastError: null }, { wallet: B, coverage: "CURRENT", pollAgeMs: 9000, lastError: null }],
  worker: { status: "healthy", ageMs: 1000 }, backup: { status: "VERIFIED" }, backupCopy: { status: "VERIFIED" }, ...over,
});
const team = (over: Partial<TeamStatus> = {}): TeamStatus => ({
  member: { id: "m1", username: "d", enabled: true }, members: [{ id: "m1", username: "d", enabled: true }, { id: "m2", username: "r", enabled: true }],
  rpcConfigured: true, telegramConfigured: true, destination: { verified: true, chatId: "5550004417", enabled: true }, deliveries: [], audit: [], ...over,
});

describe("wallet freshness and hero", () => {
  it("counts only CURRENT, fresh, error-free wallets", () => {
    const wallets = [
      { wallet: A, coverage: "CURRENT", pollAgeMs: 5000, lastError: null },
      { wallet: B, coverage: "CURRENT", pollAgeMs: 130_000, lastError: null },
      { wallet: "C", coverage: "CURRENT", pollAgeMs: 1000, lastError: "boom" },
      { wallet: "D", coverage: "CATCHING_UP", pollAgeMs: 1000, lastError: null },
    ];
    expect(countCurrent([A, B, "C", "D", "E"], wallets)).toEqual({ current: 1, total: 5 });
    expect(isWalletCurrent(undefined)).toBe(false);
    expect(isWalletCurrent({ wallet: A, coverage: "CURRENT", pollAgeMs: null, lastError: null })).toBe(false);
  });
  it("builds the headline and reason", () => {
    expect(heroSummary({ monitor: monitor(), addresses: [A, B] })).toMatchObject({ headline: "2 of 2 wallets current", status: { tone: "ok" } });
    const degraded = heroSummary({ monitor: monitor({ status: "DEGRADED", wallets: [{ wallet: A, coverage: "CURRENT", pollAgeMs: 5000, lastError: null }, { wallet: B, coverage: "CATCHING_UP", pollAgeMs: 5000, lastError: null }] }), addresses: [A, B] });
    expect(degraded.headline).toBe("1 of 2 wallets current");
    expect(degraded.status.tone).toBe("warn");
    expect(degraded.reason).toContain("7xKX…gAsU is still backfilling");
    expect(heroSummary({ monitor: monitor({ status: "WAITING_FOR_WALLETS", wallets: [] }), addresses: [] }).headline).toBe("No wallets yet");
    expect(heroSummary({ monitor: monitor({ status: "NOT_CONFIGURED", wallets: [] }), addresses: [A] }).headline).toBe("Monitor not configured");
    expect(heroSummary({ monitor: null, monitorError: "Monitor storage unavailable", addresses: [A] })).toMatchObject({ headline: "Monitor unavailable", status: { tone: "bad" } });
    expect(heroSummary({ monitor: monitor(), addresses: [A] }).headline).toBe("1 of 1 wallet current");
  });
});

describe("needs attention", () => {
  const keys = (m: MonitorHealth | null, t: TeamStatus, addresses = [A, B]) => needsAttention({ monitor: m, team: t, addresses }).map((i) => i.key);
  it("is empty when everything is fine", () => {
    expect(keys(monitor(), team())).toEqual([]);
  });
  it("derives cards only from real data and sorts by severity", () => {
    const m = monitor({ backupCopy: { status: "OVERDUE", lastSuccessAt: null }, backup: { status: "FAILED" }, worker: { status: "STALE", ageMs: 300000 },
      wallets: [{ wallet: A, coverage: "CATCHING_UP", pollAgeMs: 1000, lastError: null }] });
    const t = team({ deliveries: [{ id: "1", eventId: "e", status: "UNCERTAIN", attempts: 1, lastError: null }, { id: "2", eventId: "f", status: "FAILED", attempts: 2, lastError: null }],
      destination: { verified: false, chatId: null, enabled: false } });
    const items = needsAttention({ monitor: m, team: t, addresses: [A, B] });
    expect(items.map((i) => i.key)).toEqual(expect.arrayContaining(["copy", "backup", "worker", `wallet:${A}`, `wallet:${B}`, "uncertain", "failed", "destination"]));
    expect(items[0]!.tone).toBe("bad");
    const tones = items.map((i) => ({ bad: 0, warn: 1, neutral: 2 })[i.tone]);
    expect([...tones].sort()).toEqual(tones);
    expect(items.find((i) => i.key === `wallet:${A}`)).toMatchObject({ view: "wallets", wallet: A });
    expect(items.find((i) => i.key === "destination")).toMatchObject({ view: "setup", step: "destination" });
  });
  it("flags unconfigured rpc/telegram and paused destinations", () => {
    expect(keys(monitor(), team({ rpcConfigured: false, telegramConfigured: false }))).toEqual(expect.arrayContaining(["rpc", "telegram"]));
    expect(keys(monitor(), team({ destination: { verified: true, chatId: "1", enabled: false } }))).toContain("paused");
  });
  it("shows monitor errors and caps wallet cards", () => {
    expect(keys(null, team(), [A])).toEqual([]);
    expect(needsAttention({ monitor: null, monitorError: "down", team: team(), addresses: [A] })[0]).toMatchObject({ key: "monitor-error", tone: "bad" });
    const many = Array.from({ length: 6 }, (_, i) => `W${i}`);
    const list = needsAttention({ monitor: monitor({ wallets: [] }), team: team(), addresses: many });
    expect(list.filter((i) => i.key.startsWith("wallet:")).length).toBe(3);
    expect(list.some((i) => i.key === "wallets-more")).toBe(true);
  });
});

describe("system rows, stepper, wallet helpers", () => {
  it("renders real timestamps and states", () => {
    const now = Date.parse("2026-10-01T12:00:00Z");
    const rows = systemRows(monitor({ backup: { status: "VERIFIED", lastSuccessAt: "2026-10-01T06:00:00Z" }, backupCopy: { status: "OVERDUE", lastSuccessAt: "2026-09-29T12:00:00Z" } }), team({ rpcConfigured: false }), now);
    expect(rows.find((r) => r.key === "backup")).toMatchObject({ value: "verified 6h ago", tone: "ok" });
    expect(rows.find((r) => r.key === "copy")).toMatchObject({ value: "2d ago · overdue", tone: "warn" });
    expect(rows.find((r) => r.key === "rpc")).toMatchObject({ tone: "warn" });
    expect(systemRows(null, team(), now).find((r) => r.key === "worker")!.tone).toBe("neutral");
  });
  it("marks one step as now", () => {
    const steps = stepper(team({ telegramConfigured: false, destination: null }));
    expect(steps.map((s) => s.state)).toEqual(["done", "now", "todo", "done"]);
    expect(stepper(team()).every((s) => s.state === "done")).toBe(true);
    expect(stepper(team({ members: [{ id: "m1", username: "d", enabled: true }] })).find((s) => s.key === "team")!.state).toBe("now");
  });
  it("computes wallet stats and scoped rules", () => {
    const stats = walletStats([
      obs(A, { outcome: "CLASSIFIED", trades: [{ side: "BUY", mint: MINT, qty: 1 }, { side: "BUY", mint: MINT, qty: 2 }] }),
      obs(A, { outcome: "CLASSIFIED", trades: [{ side: "SELL", mint: MINT, qty: 1 }] }),
      obs(A, { outcome: "UNKNOWN" }), obs(A, { outcome: "FAILED", parserVersion: 4 }),
    ]);
    expect(stats).toEqual({ observations: 4, buys: 2, sells: 1, legs: 3, unclassified: 1, failed: 1, parserRevision: 4 });
    const rule = { id: "1", name: "n", trigger: "TRACKED_WALLET_BUY", enabled: true, cooldownMinutes: 1, wallet: A, mint: null };
    expect(rulesForWallet([rule, { ...rule, id: "2", wallet: null }, { ...rule, id: "3", enabled: false }], A)).toMatchObject({ enabled: 1, rules: [{ id: "1" }, { id: "3" }] });
  });
});

describe("day grouping", () => {
  it("groups by local day with Today / Yesterday / date / Recent", () => {
    const now = new Date(2026, 9, 1, 12, 0, 0);
    const at = (d: Date) => Math.floor(d.getTime() / 1000);
    const groups = groupByDay([
      obs(A, { blockTime: at(new Date(2026, 9, 1, 11, 0)) }), obs(A, { blockTime: at(new Date(2026, 9, 1, 1, 0)) }),
      obs(A, { blockTime: at(new Date(2026, 8, 30, 23, 0)) }), obs(A, { blockTime: at(new Date(2026, 8, 20, 9, 0)) }), obs(A, { blockTime: null }),
    ], now);
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([["Today", 2], ["Yesterday", 1], ["Sun, Sep 20", 1], ["Recent", 1]]);
    expect(formatDayLabel(new Date(2025, 11, 31), now)).toBe("Wed, Dec 31, 2025");
  });
});

describe("chart building", () => {
  it("classifies observations", () => {
    expect(classify(item({ outcome: "FAILED" }))).toBe("failed");
    expect(classify(item({ outcome: "CLASSIFIED", trades: [{ side: "BUY", mint: MINT, qty: 1 }] }))).toBe("buy");
    expect(classify(item({ outcome: "CLASSIFIED", trades: [{ side: "SELL", mint: MINT, qty: 1 }] }))).toBe("sell");
    expect(classify(item({ outcome: "UNKNOWN" }))).toBe("other");
  });
  it("builds cumulative points ordered by chain position", () => {
    const points = buildPoints([obs(A, { slot: 30, signature: "c" }), obs(B, { slot: 10, signature: "a" }), obs(A, { slot: 20, signature: "b" })]);
    expect(points.map((p) => [p.signature, p.count])).toEqual([["a", 1], ["b", 2], ["c", 3]]);
  });
  it("uses block time when all points have it, else slots", () => {
    const timed = buildPoints([obs(A, { slot: 1, blockTime: 100 }), obs(A, { slot: 2, blockTime: 200 }), obs(A, { slot: 3, blockTime: 400 })]);
    const l1 = layoutChart(timed, 308, 100, { left: 4, right: 4, top: 10, bottom: 10 });
    expect(l1.mode).toBe("time");
    expect(l1.xs).toEqual([4, 104, 304]);
    expect(l1.ys[2]).toBe(10);
    const mixed = buildPoints([obs(A, { slot: 0, blockTime: null }), obs(A, { slot: 100, blockTime: 5 })]);
    expect(layoutChart(mixed, 104, 100, { left: 2, right: 2, top: 0, bottom: 0 }).mode).toBe("slot");
    expect(layoutChart([], 100, 100, { left: 0, right: 0, top: 0, bottom: 0 }).path).toBe("");
    const one = layoutChart(buildPoints([obs(A, {})]), 100, 100, { left: 0, right: 0, top: 0, bottom: 0 });
    expect(one.xs).toEqual([50]);
  });
  it("applies marker filters and finds the nearest point", () => {
    expect(isMarked("buy", "all") && isMarked("sell", "all") && isMarked("failed", "all")).toBe(true);
    expect(isMarked("sell", "buys")).toBe(false);
    expect(isMarked("failed", "sells")).toBe(false);
    expect(isMarked("other", "all")).toBe(false);
    expect(isMarked("other", "unclassified")).toBe(true);
    expect(nearestIndex([10, 50, 90], 60)).toBe(1);
    expect(nearestIndex([], 5)).toBe(-1);
    expect(sparklinePath([], 96, 32)).toBe("");
    expect(sparklinePath([obs(A, { slot: 1 }), obs(A, { slot: 2 })], 96, 32)).toMatch(/^M0,30/);
  });
});

describe("inbox helpers", () => {
  it("derives side only when unambiguous", () => {
    expect(inboxSide({ title: "BUY detected", body: "x" })).toBe("buy");
    expect(inboxSide({ title: "Wallet alert", body: "sell 3" })).toBe("sell");
    expect(inboxSide({ title: "BUY then SELL", body: "" })).toBe("neutral");
    expect(inboxSide({ title: "Rule matched", body: "buyer" })).toBe("neutral");
  });
  it("drops demo events and sorts newest first", () => {
    const base = { title: "", body: "", delivered: true, suppressedReason: null };
    const events = inboxEvents([{ ...base, id: "a", createdAt: "2026-01-01T00:00:00Z", isDemo: false }, { ...base, id: "b", createdAt: "2026-01-02T00:00:00Z", isDemo: false }, { ...base, id: "c", createdAt: "2026-01-03T00:00:00Z", isDemo: true }]);
    expect(events.map((e) => e.id)).toEqual(["b", "a"]);
  });
});

describe("wallet-scoped rule creation safety", () => {
  const input = { side: "BUY" as const, name: "n", wallet: A, mint: "", cooldownMinutes: 5 };
  it("patches the new rule with wallet, token and cooldown", async () => {
    const calls: unknown[] = [];
    const id = await createScopedRule(input, { create: async (n, t) => { calls.push(["create", n, t]); return { rule: { id: "r1" } }; }, patch: async (i, p) => { calls.push(["patch", i, p]); }, remove: async () => { calls.push("remove"); } });
    expect(id).toBe("r1");
    expect(calls).toEqual([["create", "n", "TRACKED_WALLET_BUY"], ["patch", "r1", { name: "n", wallet: A, mint: null, cooldownMinutes: 5 }]]);
  });
  it("deletes the rule when the patch fails and reports it", async () => {
    const removed: string[] = [];
    await expect(createScopedRule(input, { create: async () => ({ rule: { id: "r2" } }), patch: async () => { throw new HttpError("bad", 400, "INVALID_REQUEST"); }, remove: async (i) => { removed.push(i); } }))
      .rejects.toMatchObject({ cleanedUp: true, message: expect.stringContaining("was not created") });
    expect(removed).toEqual(["r2"]);
  });
  it("warns loudly when the cleanup also fails, and passes 401 through", async () => {
    await expect(createScopedRule(input, { create: async () => ({ rule: { id: "r3" } }), patch: async () => { throw new Error("x"); }, remove: async () => { throw new Error("y"); } }))
      .rejects.toMatchObject({ cleanedUp: false, message: expect.stringContaining("could not be removed") });
    await expect(createScopedRule(input, { create: async () => ({ rule: { id: "r4" } }), patch: async () => { throw new HttpError("no", 401); }, remove: async () => undefined })).rejects.toBeInstanceOf(HttpError);
    await expect(createScopedRule(input, { create: async () => ({}), patch: async () => undefined, remove: async () => undefined })).rejects.toMatchObject({ cleanedUp: false });
  });
});

describe("format additions", () => {
  it("validates addresses and warns about secrets", () => {
    expect(addressProblem("")).toBeNull();
    expect(addressProblem(A)).toBeNull();
    expect(addressProblem("nope")).toMatch(/does not look like a Solana address/);
    expect(addressProblem("a".repeat(88))).toMatch(/private key/);
    expect(addressProblem("word ".repeat(12))).toMatch(/seed phrase/);
  });
  it("formats cooldowns and chat ids", () => {
    expect([0, 30, 60, 120, 1440, 2880, 90].map(formatCooldown)).toEqual(["no cooldown", "30 min", "1 hour", "2 hours", "1 day", "2 days", "90 min"]);
    expect(maskChatId("5550004417")).toBe("••••4417");
    expect(maskChatId("-100123456")).toBe("••••3456");
    expect(maskChatId(null)).toBe("—");
  });
});
