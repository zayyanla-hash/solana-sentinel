import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresTeamStore } from "@sat/database";
const url = process.env.SENTINEL_TEST_DATABASE_URL;
const parsed = url ? new URL(url) : null;
const allowed = parsed && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) && /test/i.test(parsed.pathname);
describe.skipIf(!allowed)("Shared team authentication", () => {
  const schema = `team_${randomUUID().replaceAll("-", "")}`;
  const scoped = new URL(url || "postgres://unused@127.0.0.1/test"); scoped.searchParams.set("options", `-c search_path=${schema}`);
  const { Pool } = createRequire(new URL("../packages/database/package.json", import.meta.url))("pg");
  const admin = new Pool({ connectionString: url });
  const pool = new Pool({ connectionString: scoped.toString() });
  const store = new PostgresTeamStore(scoped.toString(), randomBytes(32).toString("hex"));
  let memberId: string;
  const one = randomBytes(32).toString("hex"), two = randomBytes(32).toString("hex");
  beforeAll(async () => { await admin.query(`create schema ${schema}`); await store.init(); });
  afterAll(async () => { await store.close(); await pool.end(); await admin.query(`drop schema ${schema} cascade`); await admin.end(); });
  it("keeps credentials hashed, sessions opaque, and members independent", async () => {
    memberId = (await store.provision("owner", one)).id;
    await store.provision("collaborator", two);
    await expect(store.provision("third", one)).rejects.toThrow("TEAM_MEMBER_LIMIT");
    expect(await store.login("owner", two)).toBeNull();
    const a = (await store.login("owner", one))!, b = (await store.login("collaborator", two))!;
    expect((await store.authenticate(a.token))?.username).toBe("owner");
    expect((await store.authenticate(b.token))?.username).toBe("collaborator");
    const persisted = JSON.stringify((await pool.query("select * from sat_team_members")).rows) + JSON.stringify((await pool.query("select * from sat_team_sessions")).rows);
    expect(persisted).not.toContain(one); expect(persisted).not.toContain(a.token);
    await store.logout(a.token); expect(await store.authenticate(a.token)).toBeNull(); expect(await store.authenticate(b.token)).not.toBeNull();
  });
  it("revokes rotated and expired sessions and disables member access", async () => {
    const a = (await store.login("owner", one))!;
    await store.provision("owner", two);
    expect(await store.authenticate(a.token)).toBeNull(); expect(await store.login("owner", one)).toBeNull();
    const rotated = (await store.login("owner", two))!;
    await pool.query("update sat_team_sessions set expires_at=now()-interval '1 second' where member_id=$1", [memberId]);
    expect(await store.authenticate(rotated.token)).toBeNull();
    const fresh = (await store.login("owner", two))!; await store.revoke(memberId);
    expect(await store.authenticate(fresh.token)).toBeNull(); expect(await store.login("owner", two)).toBeNull();
  });
  it("encrypts configuration and rejects wrong keys without revealing stored values", async () => {
    const secret = "https://rpc.example.test/?api-key=" + randomBytes(20).toString("hex");
    await store.setSecret("rpc", secret); expect(await store.getSecret("rpc")).toBe(secret);
    expect(JSON.stringify((await pool.query("select * from sat_team_settings")).rows)).not.toContain(secret);
    const wrong = new PostgresTeamStore(scoped.toString(), randomBytes(32).toString("hex"));
    try { await expect(wrong.getSecret("rpc")).rejects.toThrow(); } finally { await wrong.close(); }
  });
  it("limits unknown-user login attempts durably across processes", async () => {
    await pool.query("delete from sat_team_login_limits");
    for (let n = 0; n < 30; n++) expect(await store.login(`unknown-${n}`, one)).toBeNull();
    const another = new PostgresTeamStore(scoped.toString());
    try { await expect(another.login("collaborator", two)).rejects.toThrow("LOGIN_RATE_LIMITED"); } finally { await another.close(); }
    expect(Number((await pool.query("select count(*) from sat_team_login_limits")).rows[0].count)).toBe(1);
  });
});
