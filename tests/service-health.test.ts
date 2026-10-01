import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, statfs, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StatsFs } from "node:fs";
import { serviceHealth, storageHealth } from "../apps/web/src/lib/service-health";

vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, statfs: vi.fn(fs.statfs) };
});
const GiB = 1024 ** 3;
const filesystems = (free: number, total: number) => ({ bavail: free, blocks: total, bsize: 1 } as StatsFs);
let directory: string | undefined;
afterEach(async () => {
  vi.clearAllMocks(); vi.unstubAllEnvs();
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("host disk capacity", () => {
  it.each([
    [5 * GiB, 50 * GiB, "OK"],
    [5 * GiB - 1, 20 * GiB, "LOW"],
    [9 * GiB, 100 * GiB, "LOW"],
    [0, 100 * GiB, "LOW"],
  ])("checks both absolute space and percent: %i / %i", async (free, total, status) => {
    vi.mocked(statfs).mockResolvedValueOnce(filesystems(free, total));
    expect(await storageHealth("/private/host/monitor.json")).toMatchObject({ status, availableBytes: free, totalBytes: total });
    expect(statfs).toHaveBeenCalledWith("/private/host");
  });
  it.each([[NaN, GiB], [GiB, 0], [-1, GiB], [2 * GiB, GiB]])("does not report invalid metrics as healthy", async (free, total) => {
    vi.mocked(statfs).mockResolvedValueOnce(filesystems(free, total));
    expect(await storageHealth("/private/monitor.json")).toMatchObject({ status: "UNKNOWN", availableBytes: null });
  });
  it("does not disclose paths or filesystem errors", async () => {
    vi.mocked(statfs).mockRejectedValueOnce(new Error("secret host path /private/example"));
    const result = await storageHealth("/private/example/monitor.json");
    expect(result.status).toBe("UNKNOWN");
    expect(JSON.stringify(result)).not.toContain("private");
    expect((await storageHealth(undefined)).status).toBe("NOT_CONFIGURED");
  });
  it("reads real host health alongside capacity without exposing private fields", async () => {
    directory = await mkdtemp(join(tmpdir(), "sentinel-health-"));
    const worker = join(directory, "monitor.json"), backup = join(directory, "backup.json");
    vi.stubEnv("SENTINEL_MONITOR_HEALTH_FILE", worker);
    vi.stubEnv("SENTINEL_BACKUP_HEALTH_FILE", backup);
    vi.stubEnv("SENTINEL_BACKUP_COPY_HEALTH_FILE", "");
    await writeFile(worker, JSON.stringify({ at: new Date().toISOString(), status: "healthy", rpcUrl: "secret" }));
    await writeFile(backup, JSON.stringify({ at: new Date().toISOString(), status: "verified", privateDump: "secret", recoveryConfigIncluded: true }));
    const result = await serviceHealth();
    expect(result.worker.status).toBe("healthy");
    expect(result.backup.status).toBe("VERIFIED");
    expect(result.storage.availableBytes).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain(directory);
    await writeFile(backup, JSON.stringify({ at: new Date().toISOString(), status: "verified" }));
    expect((await serviceHealth()).backup.status).toBe("DATABASE_ONLY");
  });
});
