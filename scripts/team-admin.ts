import { randomBytes } from "node:crypto";
import { open, mkdir } from "node:fs/promises";
import path from "node:path";
import { PostgresTeamStore } from "../packages/database/src/index";

async function main() {
  const [action, username, flag, destination] = process.argv.slice(2);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  const store = new PostgresTeamStore(process.env.DATABASE_URL);
  try {
    if (action === "list") { console.log(JSON.stringify(await store.listMembers())); return; }
    if (action === "revoke" && username) {
      const member = (await store.listMembers()).find((m) => m.username === username);
      if (!member) throw new Error("MEMBER_NOT_FOUND");
      await store.revoke(member.id); console.log("Member revoked; existing sessions no longer authorize requests."); return;
    }
    if (action !== "add" || !username) throw new Error("Usage: team-admin.ts add <username> [--generate /absolute/private/file] | revoke <username> | list");
    let credential: string;
    if (flag === "--generate" && destination && path.isAbsolute(destination)) {
      credential = randomBytes(24).toString("base64url");
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      const file = await open(destination, "wx", 0o600);
      try { await file.writeFile(credential + "\n"); await file.sync(); } finally { await file.close(); }
    } else {
      if (flag || process.stdin.isTTY) throw new Error("Supply credential through stdin or --generate /absolute/private/file; never through command arguments.");
      let input = "";
      for await (const chunk of process.stdin) { input += String(chunk); if (input.length > 512) throw new Error("CREDENTIAL_TOO_LONG"); }
      credential = input.trim();
    }
    await store.provision(username, credential);
    console.log("Member credential provisioned. Share its private file only with the intended member.");
  } finally { await store.close(); }
}
main().catch((e) => { console.error(e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : "Team administration failed; check arguments and database status."); process.exitCode = 1; });
