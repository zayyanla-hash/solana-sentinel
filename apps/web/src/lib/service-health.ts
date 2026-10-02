import { readFile, statfs } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const MINIMUM_FREE_BYTES = 5 * 1024 ** 3;
export type StorageHealth = {
  status: "OK" | "LOW" | "UNKNOWN" | "NOT_CONFIGURED";
  availableBytes: number | null;
  totalBytes: number | null;
  availablePercent: number | null;
  minimumAvailableBytes: number;
};
export async function storageHealth(path: string | undefined): Promise<StorageHealth> {
  const unavailable: StorageHealth = { status: path ? "UNKNOWN" : "NOT_CONFIGURED", availableBytes: null,
    totalBytes: null, availablePercent: null, minimumAvailableBytes: MINIMUM_FREE_BYTES };
  if (!path) return unavailable;
  try {
    // Installed Mac health files live beside the database, archives and backups.
    const fs = await statfs(dirname(resolve(path)));
    const availableBytes = fs.bavail * fs.bsize;
    const totalBytes = fs.blocks * fs.bsize;
    if (!Number.isSafeInteger(availableBytes) || !Number.isSafeInteger(totalBytes) ||
        availableBytes < 0 || totalBytes <= 0 || availableBytes > totalBytes) return unavailable;
    const availablePercent = availableBytes / totalBytes * 100;
    return { status: availableBytes < MINIMUM_FREE_BYTES || availablePercent < 10 ? "LOW" : "OK",
      availableBytes, totalBytes, availablePercent, minimumAvailableBytes: MINIMUM_FREE_BYTES };
  } catch { return unavailable; }
}

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
  const [heartbeat, backup, copy, storage] = await Promise.all([
    read(process.env.SENTINEL_MONITOR_HEALTH_FILE), read(process.env.SENTINEL_BACKUP_HEALTH_FILE), read(process.env.SENTINEL_BACKUP_COPY_HEALTH_FILE),
    storageHealth(process.env.SENTINEL_MONITOR_HEALTH_FILE),
  ]);
  const heartbeatAge = age(heartbeat?.at);
  const status = (entry: Record<string, unknown> | null, success: string) => {
    const elapsed = age(entry?.at);
    return { status: !entry ? "NOT_CONFIGURED" : entry.status !== success ? "FAILED" : elapsed === null || elapsed < 0 || elapsed > 36 * 3600000 ? "OVERDUE" : entry.recoveryConfigIncluded !== true ? "DATABASE_ONLY" : "VERIFIED",
      lastSuccessAt: entry?.status === success && typeof entry.at === "string" ? entry.at : null };
  };
  return {
    worker: { status: heartbeatAge === null ? "NO_HEARTBEAT" : heartbeatAge < 0 || heartbeatAge > 120000 ? "STALE" :
      typeof heartbeat?.status === "string" ? heartbeat.status : "UNKNOWN", ageMs: heartbeatAge },
    backup: status(backup, "verified"), backupCopy: status(copy, "copied"), storage,
  };
}
