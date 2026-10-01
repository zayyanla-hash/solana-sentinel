import { readFile } from "node:fs/promises";

async function read(path: string | undefined): Promise<Record<string, unknown> | null> {
  if (!path) return null;
  try {
    const text = await readFile(path, "utf8");
    if (text.length > 1024 * 1024) return null;
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}
const age = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? Date.now() - Date.parse(value) : null;
export async function serviceHealth() {
  const [heartbeat, backup, copy] = await Promise.all([
    read(process.env.SENTINEL_MONITOR_HEALTH_FILE), read(process.env.SENTINEL_BACKUP_HEALTH_FILE), read(process.env.SENTINEL_BACKUP_COPY_HEALTH_FILE),
  ]);
  const heartbeatAge = age(heartbeat?.at);
  const status = (entry: Record<string, unknown> | null, success: string) => {
    const elapsed = age(entry?.at);
    return { status: !entry ? "NOT_CONFIGURED" : entry.status !== success ? "FAILED" : elapsed === null || elapsed < 0 || elapsed > 36 * 3600000 ? "OVERDUE" : "VERIFIED",
      lastSuccessAt: entry?.status === success && typeof entry.at === "string" ? entry.at : null };
  };
  return {
    worker: { status: heartbeatAge === null ? "NO_HEARTBEAT" : heartbeatAge < 0 || heartbeatAge > 120000 ? "STALE" :
      typeof heartbeat?.status === "string" ? heartbeat.status : "UNKNOWN", ageMs: heartbeatAge },
    backup: status(backup, "verified"), backupCopy: status(copy, "copied"),
  };
}
