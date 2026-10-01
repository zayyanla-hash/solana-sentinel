import { fork, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DurableWalletHistoryProvider } from "@sat/solana";

const children: ChildProcess[] = [];
const dirs: string[] = [];
function launch(directory: string, mode: string) {
  const child = fork(resolve("tests/fixtures/history-process.ts"), [directory, mode], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "ignore", "ipc"] });
  children.push(child); return child;
}
function message(child: ChildProcess): Promise<{ phase: string; trades?: number }> {
  return new Promise((resolveMessage, reject) => {
    const timer = setTimeout(() => reject(new Error("fixture-child-timeout")), 5000);
    child.once("message", (data) => { clearTimeout(timer); resolveMessage(data as { phase: string; trades?: number }); });
    child.once("error", (err) => { clearTimeout(timer); reject(err); });
  });
}
function exited(child: ChildProcess) {
  if (child.exitCode != null || child.signalCode != null) return Promise.resolve();
  return new Promise<void>((done) => child.once("exit", () => done()));
}
afterEach(async () => {
  await Promise.all(children.splice(0).map(async (child) => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await exited(child); }));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});
describe("actual child-process history restart boundaries", () => {
  it("SIGTERM closes the writer, and a new process replays without duplicated records", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sentinel-process-")); dirs.push(dir);
    const seed = launch(dir, "seed");
    expect(await message(seed)).toEqual({ phase: "committed", trades: 1 });
    seed.kill("SIGTERM"); await exited(seed); expect(seed.exitCode).toBe(0);
    const replay = launch(dir, "replay");
    expect(await message(replay)).toEqual({ phase: "committed", trades: 1 });
    await exited(replay); expect(replay.exitCode).toBe(0);
  });
  it("SIGKILL before rename preserves the prior file and fails closed on orphaned writer ownership", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sentinel-process-")); dirs.push(dir);
    const seed = launch(dir, "replay"); await message(seed); await exited(seed);
    const before = await readFile(join(dir, `${"1".repeat(32)}.json`), "utf8");
    const partial = launch(dir, "partial-write");
    expect(await message(partial)).toEqual({ phase: "before-rename" });
    partial.kill("SIGKILL"); await exited(partial);
    expect(await readFile(join(dir, `${"1".repeat(32)}.json`), "utf8")).toBe(before);
    const blocked = new DurableWalletHistoryProvider({ name: "unused", isDemo: false, getTrades: async () => { throw new Error("must-not-fetch"); } }, dir);
    await expect(blocked.getTrades("1".repeat(32))).rejects.toThrow("history-store-locked"); await blocked.close();
    // Test-only manual recovery after confirming that our own child is dead.
    await unlink(join(dir, ".writer.lock"));
    const recovered = launch(dir, "replay"); expect((await message(recovered)).trades).toBe(1);
    await exited(recovered); expect(recovered.exitCode).toBe(0);
  });
});
