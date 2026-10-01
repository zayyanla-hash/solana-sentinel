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
