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
