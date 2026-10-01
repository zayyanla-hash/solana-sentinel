const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** Cheap client-side pre-check. The server remains authoritative. */
export function isBase58Address(value: string): boolean {
  return value.length >= 32 && value.length <= 44 && BASE58.test(value);
}

export function shortAddress(value: string, head = 4, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** 12s, 4m, 3h, 2d. Null or negative durations are unknown. */
export function formatAge(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** HH:MM:SS in the viewer's local time. */
export function formatClock(value: number | string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** YYYY-MM-DD HH:MM in the viewer's local time. Invalid input renders as an em dash. */
export function formatTime(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Quantity only (no USD). Thousands separators, up to 6 decimals. */
export function formatQty(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Local calendar key, YYYY-MM-DD. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "Today", "Yesterday" or "Mon, Sep 29" (with the year when it is not the current one), in local time. */
export function formatDayLabel(date: Date, now: Date): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  const base = `${WEEKDAYS[day.getDay()]}, ${MONTHS[day.getMonth()]} ${day.getDate()}`;
  return day.getFullYear() === today.getFullYear() ? base : `${base}, ${day.getFullYear()}`;
}

/** HH:MM in local time. */
export function formatHourMinute(value: number | string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "••••4417" — never the full chat id. */
export function maskChatId(chatId: string | null | undefined): string {
  if (!chatId) return "—";
  return `••••${chatId.replace(/^-/, "").slice(-4)}`;
}

/**
 * Inline validation for a pasted wallet address. Longer strings or ones with spaces are called out because they
 * may be a private key or seed phrase, which must never be pasted into the app. The server stays authoritative.
 */
export function addressProblem(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/\s/.test(value)) return "A wallet address has no spaces. If this is a seed phrase, never paste it here — use a public address only.";
  if (value.length > 44) return "That is longer than any wallet address. If it is a private key, never paste it here — use a public address only.";
  if (!isBase58Address(value)) return "That does not look like a Solana address (32–44 base58 characters).";
  return null;
}

/** 0 -> "no cooldown", 45 -> "45 min", 60 -> "1 hour", 1440 -> "1 day". */
export function formatCooldown(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "—";
  if (minutes === 0) return "no cooldown";
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} min`;
}
