import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import pg from "pg";
import { AlertEventSchema, type AlertEvent } from "@sat/shared";
import { buildPoolConfig } from "./postgres";

const { Pool } = pg;

export type DeliveryStatus = "PENDING" | "SENDING" | "SENT" | "RETRYING" | "FAILED" | "UNCERTAIN";
export interface TelegramDestination {
  memberId: string;
  verified: boolean;
  enabled: boolean;
  chatId: string | null;
  verifiedAt: string | null;
}
export interface TelegramDelivery {
  id: string;
  eventId: string;
  memberId: string;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  messageId: number | null;
  createdAt: string;
  updatedAt: string;
}
export interface ClaimedTelegramDelivery extends TelegramDelivery {
  leaseToken: string;
  chatId: string;
  event: AlertEvent;
}
export type TelegramSendResult =
  | { kind: "sent"; messageId: number }
  | { kind: "retry"; reason: string; retryAfterSeconds?: number }
  | { kind: "failed"; reason: string }
  | { kind: "uncertain"; reason: string };

export const DELIVERY_SCHEMA_SQL = `
create table if not exists sat_team_destinations (
  member_id uuid primary key references sat_team_members(id) on delete cascade,
  chat_id text,
  verified_at timestamptz,
  enabled boolean not null default true,
  pending_chat_id text,
  challenge_salt text,
  challenge_hash text,
  challenge_expires_at timestamptz,
  challenge_attempts integer not null default 0,
  check (chat_id is null or chat_id ~ '^-?[0-9]{1,20}$'),
  check (pending_chat_id is null or pending_chat_id ~ '^-?[0-9]{1,20}$')
);
create table if not exists sat_team_deliveries (
  id uuid primary key,
  event_id uuid not null,
  member_id uuid not null references sat_team_members(id) on delete cascade,
  event jsonb not null,
  status text not null check (status in ('PENDING','SENDING','SENT','RETRYING','FAILED','UNCERTAIN')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_at timestamptz,
  last_error text,
  message_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, member_id)
);
create index if not exists sat_team_deliveries_due_idx on sat_team_deliveries (next_attempt_at, created_at) where status in ('PENDING','RETRYING');
create index if not exists sat_team_deliveries_member_idx on sat_team_deliveries (member_id, created_at desc);
create table if not exists sat_team_telegram_limits (
  member_id uuid primary key references sat_team_members(id) on delete cascade,
  last_verification_at timestamptz,
  last_test_at timestamptz
);
alter table sat_team_destinations enable row level security;
alter table sat_team_deliveries enable row level security;
alter table sat_team_telegram_limits enable row level security;
`;

function validChatId(value: string): boolean {
  return /^-?[0-9]{1,20}$/.test(value) && value !== "0";
}

function validMemberId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function rowDelivery(row: Record<string, unknown>): TelegramDelivery {
  return {
    id: String(row.id), eventId: String(row.event_id), memberId: String(row.member_id),
    status: row.status as DeliveryStatus, attempts: Number(row.attempts),
    nextAttemptAt: new Date(String(row.next_attempt_at)).toISOString(),
    lastError: row.last_error == null ? null : String(row.last_error),
    messageId: row.message_id == null ? null : Number(row.message_id),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

/** Durable, per-member Telegram queue. No Telegram credentials are stored here. */
export class PostgresDeliveryStore {
  private readonly pool: pg.Pool;
  private ready: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.pool = new Pool({ ...buildPoolConfig(connectionString), statement_timeout: 15_000, lock_timeout: 5_000 });
    this.pool.on("error", () => console.error("sat delivery database connection error"));
  }

  async init(): Promise<void> {
    if (!this.ready) this.ready = this.pool.query(DELIVERY_SCHEMA_SQL).then(() => undefined).catch((error) => {
      this.ready = null;
      throw error;
    });
    await this.ready;
  }

  async close(): Promise<void> { await this.pool.end(); }

  /** Return this code only to server-side code that sends it to the proposed chat. */
  async beginDestinationVerification(memberId: string, chatId: string): Promise<{ challenge: string; expiresAt: string }> {
    if (!validMemberId(memberId)) throw new Error("MEMBER_ID_INVALID");
    if (!validChatId(chatId)) throw new Error("TELEGRAM_CHAT_ID_INVALID");
    await this.init();
    const challenge = String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
    const salt = randomBytes(24).toString("hex");
    const hash = createHash("sha256").update(`${salt}:${challenge}`).digest("hex");
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const limited = await client.query(`insert into sat_team_telegram_limits (member_id, last_verification_at)
        select id, now() from sat_team_members where id = $1 and enabled
        on conflict (member_id) do update set last_verification_at = now()
        where sat_team_telegram_limits.last_verification_at is null
          or sat_team_telegram_limits.last_verification_at < now() - interval '1 minute'
        returning member_id`, [memberId]);
      if (!limited.rowCount) throw new Error("TELEGRAM_VERIFICATION_RATE_LIMITED");
      await client.query(`insert into sat_team_destinations
      (member_id, pending_chat_id, challenge_salt, challenge_hash, challenge_expires_at, challenge_attempts)
      values ($1, $2, $3, $4, $5, 0)
      on conflict (member_id) do update set pending_chat_id = excluded.pending_chat_id,
        challenge_salt = excluded.challenge_salt, challenge_hash = excluded.challenge_hash,
        challenge_expires_at = excluded.challenge_expires_at, challenge_attempts = 0`,
      [memberId, chatId, salt, hash, expiresAt]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally { client.release(); }
    return { challenge, expiresAt };
  }

  /** Reserve one explicit test send per member per minute across all app processes. */
  async authorizeTest(memberId: string): Promise<void> {
    if (!validMemberId(memberId)) throw new Error("MEMBER_ID_INVALID");
    await this.init();
    const result = await this.pool.query(`insert into sat_team_telegram_limits (member_id, last_test_at)
      select id, now() from sat_team_members where id = $1 and enabled
      on conflict (member_id) do update set last_test_at = now()
      where sat_team_telegram_limits.last_test_at is null
        or sat_team_telegram_limits.last_test_at < now() - interval '1 minute'
      returning member_id`, [memberId]);
    if (!result.rowCount) throw new Error("TELEGRAM_TEST_RATE_LIMITED");
  }

  async cancelDestinationVerification(memberId: string): Promise<void> {
    if (!validMemberId(memberId)) throw new Error("MEMBER_ID_INVALID");
    await this.init();
    await this.pool.query(`update sat_team_destinations set pending_chat_id = null, challenge_salt = null,
      challenge_hash = null, challenge_expires_at = null, challenge_attempts = 0 where member_id = $1`, [memberId]);
  }

  async verifyDestination(memberId: string, challenge: string): Promise<TelegramDestination> {
    if (!validMemberId(memberId)) throw new Error("MEMBER_ID_INVALID");
    if (!/^[0-9]{6}$/.test(challenge)) throw new Error("TELEGRAM_CODE_INVALID");
    await this.init();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(`select * from sat_team_destinations where member_id = $1 for update`, [memberId]);
      const row = result.rows[0];
      if (!row?.challenge_hash || !row.pending_chat_id || !row.challenge_expires_at ||
          Date.parse(row.challenge_expires_at) <= Date.now() || row.challenge_attempts >= 5) {
        throw new Error("TELEGRAM_CODE_EXPIRED");
      }
      await client.query("update sat_team_destinations set challenge_attempts = challenge_attempts + 1 where member_id = $1", [memberId]);
      const actual = createHash("sha256").update(`${row.challenge_salt}:${challenge}`).digest();
      const expected = Buffer.from(row.challenge_hash, "hex");
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        await client.query("commit");
        throw new Error("TELEGRAM_CODE_INVALID");
      }
      const updated = await client.query(`update sat_team_destinations set chat_id = pending_chat_id,
        verified_at = now(), enabled = true, pending_chat_id = null, challenge_salt = null,
        challenge_hash = null, challenge_expires_at = null, challenge_attempts = 0
        where member_id = $1 returning *`, [memberId]);
      await client.query(`update sat_team_deliveries set status = 'FAILED', last_error = 'DESTINATION_CHANGED',
        updated_at = now() where member_id = $1 and status in ('PENDING','RETRYING')`, [memberId]);
      await client.query(`update sat_team_deliveries set status = 'UNCERTAIN', last_error = 'DESTINATION_CHANGED_DURING_SEND',
        lease_token = null, lease_at = null, updated_at = now()
        where member_id = $1 and status = 'SENDING'`, [memberId]);
      await client.query("commit");
      return this.destinationFromRow(updated.rows[0]);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  private destinationFromRow(row: Record<string, unknown>): TelegramDestination {
    return {
      memberId: String(row.member_id), verified: !!row.verified_at && !!row.chat_id,
      enabled: !!row.enabled, chatId: row.chat_id == null ? null : String(row.chat_id),
      verifiedAt: row.verified_at ? new Date(String(row.verified_at)).toISOString() : null,
    };
  }

  async getDestination(memberId: string): Promise<TelegramDestination | null> {
    if (!validMemberId(memberId)) throw new Error("MEMBER_ID_INVALID");
    await this.init();
    const result = await this.pool.query("select * from sat_team_destinations where member_id = $1", [memberId]);
    return result.rows[0] ? this.destinationFromRow(result.rows[0]) : null;
  }

  async setDestinationEnabled(memberId: string, enabled: boolean): Promise<void> {
    if (!validMemberId(memberId)) throw new Error("MEMBER_ID_INVALID");
    await this.init();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(`update sat_team_destinations set enabled = $2,
        verified_at = case when $2 and not enabled then now() else verified_at end
        where member_id = $1`, [memberId, enabled]);
      if (!enabled) await client.query(`update sat_team_deliveries set status = 'FAILED',
        last_error = 'DESTINATION_DISABLED', updated_at = now()
        where member_id = $1 and status in ('PENDING','RETRYING')`, [memberId]);
      if (!enabled) await client.query(`update sat_team_deliveries set status = 'UNCERTAIN',
        last_error = 'DESTINATION_DISABLED_DURING_SEND', lease_token = null, lease_at = null, updated_at = now()
        where member_id = $1 and status = 'SENDING'`, [memberId]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  /** Reconcile directly from durable facts, including events evicted from the 500-row inbox. */
  async reconcileFacts(limit = 500): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("DELIVERY_LIMIT_INVALID");
    await this.init();
    const result = await this.pool.query(`with eligible as (
      select f.id as event_id, d.member_id, f.payload as event
      from sat_alert_event_facts f cross join sat_team_destinations d
      join sat_team_members m on m.id = d.member_id and m.enabled
      where d.chat_id is not null and d.verified_at is not null and d.enabled
        and f.payload->>'channel' = 'INTERNAL' and f.payload->>'delivered' = 'true'
        and f.payload->>'isDemo' = 'false'
        and (f.payload->>'createdAt')::timestamptz >= d.verified_at
        and not exists (select 1 from sat_team_deliveries x where x.event_id = f.id and x.member_id = d.member_id)
      order by (f.payload->>'createdAt')::timestamptz, f.id, d.member_id limit $1
    ) insert into sat_team_deliveries (id, event_id, member_id, event, status)
      select gen_random_uuid(), event_id, member_id, event, 'PENDING' from eligible
      on conflict (event_id, member_id) do nothing`, [limit]);
    return result.rowCount ?? 0;
  }

  /** Claim atomically across workers; expired sends become UNCERTAIN, never auto-resend. */
  async claimDue(limit = 20): Promise<ClaimedTelegramDelivery[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("DELIVERY_LIMIT_INVALID");
    await this.init();
    await this.pool.query(`update sat_team_deliveries set status = 'UNCERTAIN', lease_token = null,
      last_error = 'SEND_OUTCOME_UNKNOWN', updated_at = now()
      where status = 'SENDING' and lease_at < now() - interval '90 seconds'`);
    const result = await this.pool.query(`with due as (
      select q.id from sat_team_deliveries q join sat_team_destinations d on d.member_id = q.member_id
        join sat_team_members m on m.id = q.member_id and m.enabled
      where q.status in ('PENDING','RETRYING') and q.next_attempt_at <= now()
        and d.enabled and d.chat_id is not null and d.verified_at is not null
      order by q.next_attempt_at, q.created_at limit $1 for update of q skip locked
    ) update sat_team_deliveries q set status = 'SENDING', attempts = q.attempts + 1,
      lease_token = gen_random_uuid(), lease_at = now(), updated_at = now()
      from due, sat_team_destinations d
      where q.id = due.id and d.member_id = q.member_id
      returning q.*, d.chat_id`, [limit]);
    return result.rows.map((row) => ({
      ...rowDelivery(row), leaseToken: String(row.lease_token), chatId: String(row.chat_id),
      event: AlertEventSchema.parse(row.event),
    }));
  }

  async finishSend(id: string, leaseToken: string, result: TelegramSendResult): Promise<TelegramDelivery | null> {
    if (!validMemberId(id) || !validMemberId(leaseToken)) throw new Error("DELIVERY_ID_INVALID");
    await this.init();
    const reason = result.kind === "sent" ? null : /^[A-Z0-9_]{2,80}$/.test(result.reason)
      ? result.reason : "DELIVERY_ERROR";
    const status: DeliveryStatus = result.kind === "sent" ? "SENT"
      : result.kind === "retry" ? "RETRYING" : result.kind === "failed" ? "FAILED" : "UNCERTAIN";
    const delay = result.kind === "retry"
      ? Math.max(1, Math.min(3600, result.retryAfterSeconds ?? 30)) : 0;
    const response = await this.pool.query(`update sat_team_deliveries set status =
        case when $3 = 'RETRYING' and attempts >= 5 then 'FAILED' else $3 end,
      next_attempt_at = now() + ($4::int * interval '1 second'), last_error = $5,
      message_id = $6, lease_token = null, lease_at = null, updated_at = now()
      where id = $1 and lease_token = $2 and status = 'SENDING' returning *`,
      [id, leaseToken, status, delay, reason, result.kind === "sent" ? result.messageId : null]);
    return response.rows[0] ? rowDelivery(response.rows[0]) : null;
  }

  async manualRetry(id: string, memberId: string): Promise<TelegramDelivery | null> {
    if (!validMemberId(id) || !validMemberId(memberId)) throw new Error("DELIVERY_ID_INVALID");
    await this.init();
    const response = await this.pool.query(`update sat_team_deliveries set status = 'PENDING',
      attempts = 0, next_attempt_at = now(), last_error = null, updated_at = now()
      where id = $1 and member_id = $2 and status in ('FAILED','UNCERTAIN') returning *`, [id, memberId]);
    return response.rows[0] ? rowDelivery(response.rows[0]) : null;
  }

  async listDeliveries(memberId: string, limit = 50): Promise<TelegramDelivery[]> {
    if (!validMemberId(memberId)) throw new Error("MEMBER_ID_INVALID");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("DELIVERY_LIMIT_INVALID");
    await this.init();
    const response = await this.pool.query(`select * from sat_team_deliveries where member_id = $1
      order by created_at desc, id desc limit $2`, [memberId, limit]);
    return response.rows.map(rowDelivery);
  }

  async getStats(): Promise<{ pending: number; retrying: number; failed: number; uncertain: number }> {
    await this.init();
    const response = await this.pool.query(`select count(*) filter (where status = 'PENDING')::int as pending,
      count(*) filter (where status = 'RETRYING')::int as retrying,
      count(*) filter (where status = 'FAILED')::int as failed,
      count(*) filter (where status = 'UNCERTAIN')::int as uncertain from sat_team_deliveries`);
    return response.rows[0] as { pending: number; retrying: number; failed: number; uncertain: number };
  }
}
