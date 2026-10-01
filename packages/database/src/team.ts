import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import pg from "pg";
import { buildPoolConfig } from "./postgres";

export interface TeamMember { id: string; username: string; enabled: boolean }
export const TEAM_SCHEMA_SQL = `
create table if not exists sat_team_members (
 id uuid primary key, username text unique not null, salt text not null, credential_hash text not null,
 enabled boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists sat_team_sessions (
 hash text primary key, member_id uuid not null references sat_team_members(id) on delete cascade,
 expires_at timestamptz not null, created_at timestamptz not null default now()
);
create table if not exists sat_team_login_limits (id text primary key, attempts int not null, reset_at timestamptz not null);
create table if not exists sat_team_settings (id text primary key, encrypted text not null, updated_at timestamptz not null default now());
create table if not exists sat_team_audit (
 id uuid primary key, member_id uuid, action text not null, subject text, outcome text not null,
 created_at timestamptz not null default now()
);
create index if not exists sat_team_audit_time on sat_team_audit(created_at desc);
alter table sat_team_members enable row level security;
alter table sat_team_sessions enable row level security;
alter table sat_team_login_limits enable row level security;
alter table sat_team_settings enable row level security;
alter table sat_team_audit enable row level security;
`;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const derive = (secret: string, salt: string): Promise<Buffer> => new Promise((resolve, reject) => {
  scrypt(secret, salt, 32, (err, key) => err ? reject(err) : resolve(key));
});
const member = (row: Record<string, unknown>): TeamMember => ({ id: String(row.id), username: String(row.username), enabled: row.enabled === true });

/** Credentials and session tokens never leave this store through read APIs. */
export class PostgresTeamStore {
  private readonly pool: pg.Pool;
  private ready: Promise<void> | null = null;
  constructor(url: string, private readonly configKey = process.env.SAT_CONFIG_KEY) {
    this.pool = new pg.Pool({ ...buildPoolConfig(url), statement_timeout: 15000, lock_timeout: 5000 });
    this.pool.on("error", () => {});
  }
  async init(): Promise<void> {
    this.ready ??= (async () => {
      const c = await this.pool.connect();
      try {
        await c.query("begin");
        await c.query("select pg_advisory_xact_lock(20261001, 10)");
        await c.query(TEAM_SCHEMA_SQL);
        await c.query("commit");
      } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
    })().catch((e) => { this.ready = null; throw e; });
    await this.ready;
  }
  async provision(username: string, credential: string): Promise<TeamMember> {
    if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(username) || credential.length < 24 || credential.length > 256) throw new Error("INVALID_MEMBER_CREDENTIAL");
    await this.init();
    const salt = randomBytes(16).toString("hex"), digest = (await derive(credential, salt)).toString("hex");
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      await c.query("select pg_advisory_xact_lock(20261001, 11)");
      const existing = await c.query("select id from sat_team_members where username=$1", [username]);
      const count = await c.query("select count(*)::int n from sat_team_members");
      if (!existing.rowCount && Number(count.rows[0].n) >= 2) throw new Error("TEAM_MEMBER_LIMIT");
      const r = await c.query(`insert into sat_team_members(id,username,salt,credential_hash) values($1,$2,$3,$4)
        on conflict(username) do update set salt=$3,credential_hash=$4,enabled=true returning id,username,enabled`, [randomUUID(), username, salt, digest]);
      await c.query("delete from sat_team_sessions where member_id=$1", [r.rows[0].id]);
      await c.query("insert into sat_team_audit(id,member_id,action,subject,outcome) values($1,$2,'credential-rotated',$3,'completed')", [randomUUID(), r.rows[0].id, username]);
      await c.query("commit"); return member(r.rows[0]);
    } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
  }
  async listMembers(): Promise<TeamMember[]> {
    await this.init(); return (await this.pool.query("select id,username,enabled from sat_team_members order by created_at")).rows.map(member);
  }
  async revoke(id: string): Promise<void> {
    await this.init();
    const c = await this.pool.connect();
    try { await c.query("begin"); await c.query("update sat_team_members set enabled=false where id=$1", [id]);
      await c.query("delete from sat_team_sessions where member_id=$1", [id]); await c.query("commit");
    } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
  }
  async login(username: string, credential: string): Promise<{ token: string; member: TeamMember } | null> {
    if (username.length > 40 || credential.length > 256) return null;
    await this.init();
    // One durable bucket bounds unknown-user attempts across restarts and processes.
    const c = await this.pool.connect();
    let row: Record<string, unknown> | undefined;
    try {
      await c.query("begin"); await c.query("select pg_advisory_xact_lock(20261001,12)");
      await c.query("delete from sat_team_login_limits where reset_at<=now()");
      const limit = await c.query(`insert into sat_team_login_limits(id,attempts,reset_at) values('global',1,now()+interval '5 minutes')
        on conflict(id) do update set attempts=sat_team_login_limits.attempts+1 returning attempts`);
      await c.query("commit");
      if (Number(limit.rows[0].attempts) > 30) throw new Error("LOGIN_RATE_LIMITED");
      row = (await c.query("select * from sat_team_members where username=$1 and enabled", [username])).rows[0];
    } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
    const digest = await derive(credential, row ? String(row.salt) : "sentinel-invalid-member");
    if (!row || !timingSafeEqual(digest, Buffer.from(String(row.credential_hash), "hex"))) return null;
    const token = randomBytes(32).toString("base64url");
    await this.pool.query("delete from sat_team_sessions where expires_at<=now()");
    // Rotation racing a login must not admit a session based on the old hash.
    const saved = await this.pool.query(`insert into sat_team_sessions(hash,member_id,expires_at)
      select $1,id,now()+interval '12 hours' from sat_team_members where id=$2 and enabled and credential_hash=$3 for share`, [hash(token), row.id, row.credential_hash]);
    return saved.rowCount ? { token, member: member(row) } : null;
  }
  async authenticate(token: string | null): Promise<TeamMember | null> {
    if (!token || !/^[\w-]{43}$/.test(token)) return null;
    await this.init();
    const r = await this.pool.query(`select m.id,m.username,m.enabled from sat_team_sessions s join sat_team_members m on m.id=s.member_id
      where s.hash=$1 and s.expires_at>now() and m.enabled`, [hash(token)]);
    return r.rowCount ? member(r.rows[0]) : null;
  }
  async logout(token: string): Promise<void> { await this.init(); await this.pool.query("delete from sat_team_sessions where hash=$1", [hash(token)]); }
  private key(): Buffer {
    if (!this.configKey || !/^[a-f0-9]{64}$/i.test(this.configKey)) throw new Error("CONFIG_KEY_REQUIRED");
    return Buffer.from(this.configKey, "hex");
  }
  async setSecret(id: "rpc" | "telegram", value: string): Promise<void> {
    if (!value || value.length > 2048) throw new Error("INVALID_SECRET");
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    cipher.setAAD(Buffer.from(id));
    const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const encrypted = [iv, cipher.getAuthTag(), data].map((v) => v.toString("base64")).join(".");
    await this.init(); await this.pool.query(`insert into sat_team_settings(id,encrypted) values($1,$2)
      on conflict(id) do update set encrypted=$2,updated_at=now()`, [id, encrypted]);
  }
  async getSecret(id: "rpc" | "telegram"): Promise<string | null> {
    await this.init(); const r = await this.pool.query("select encrypted from sat_team_settings where id=$1", [id]);
    if (!r.rowCount) return null;
    const [iv, tag, data] = String(r.rows[0].encrypted).split(".").map((v) => Buffer.from(v, "base64"));
    if (!iv || !tag || !data) throw new Error("CONFIG_DECRYPT_FAILED");
    const decipher = createDecipheriv("aes-256-gcm", this.key(), iv); decipher.setAAD(Buffer.from(id)); decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  }
  async audit(memberId: string, action: string, subject: string | null, outcome: "requested" | "completed" | "failed"): Promise<void> {
    await this.init(); await this.pool.query("insert into sat_team_audit(id,member_id,action,subject,outcome) values($1,$2,$3,$4,$5)", [randomUUID(), memberId, action, subject, outcome]);
  }
  async auditHistory(): Promise<unknown[]> {
    await this.init(); return (await this.pool.query(`select a.id,m.username,a.action,a.subject,a.outcome,a.created_at
      from sat_team_audit a left join sat_team_members m on m.id=a.member_id order by a.created_at desc limit 100`)).rows;
  }
  async close(): Promise<void> { await this.pool.end(); }
}

let shared: PostgresTeamStore | undefined;
export function getTeamStore(): PostgresTeamStore {
  if (!process.env.DATABASE_URL) throw new Error("TEAM_DATABASE_REQUIRED");
  return shared ??= new PostgresTeamStore(process.env.DATABASE_URL);
}
