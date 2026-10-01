import { fork } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("actual CLI SIGINT aborts its command-owned live-history request and releases the writer lock", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sentinel-cli-"));
  let requested!: () => void;
  const observed = new Promise<void>((r) => { requested = r; });
  const server = createServer((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.write('{"data":'); requested(); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("local-server-address");
  const child = fork(resolve("apps/cli/src/index.ts"), ["analyze-wallet", "--live", "1".repeat(32)], {
    execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: { ...process.env, HELIUS_API_KEY: "synthetic-test-key", HELIUS_RPC_URL: `http://127.0.0.1:${addr.port}`,
      SAT_HISTORY_DIR: dir, DATABASE_URL: "", BIRDEYE_API_KEY: "", JUPITER_API_KEY: "", OPENAI_API_KEY: "" },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("cli-shutdown-timeout")), 5000); });
  const exited = new Promise<void>((r) => child.once("exit", () => r()));
  try {
    await Promise.race([observed, timeout]);
    expect(await readdir(dir)).toContain(".writer.lock");
    child.kill("SIGINT");
    await Promise.race([exited, timeout]);
    expect(child.exitCode).toBe(130);
    expect(await readdir(dir)).not.toContain(".writer.lock");
  } finally {
    if (timer) clearTimeout(timer);
    if (child.exitCode == null && child.signalCode == null) child.kill("SIGKILL");
    await exited;
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});
