-- Additive shared Mac release tables; preserve existing production data.


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


create table if not exists sat_ingestion_wallets (
  wallet text primary key,
  state jsonb not null,
  version int not null default 0 check (version >= 0)
);
create table if not exists sat_chain_observations (
  wallet text not null,
  signature text not null,
  slot bigint not null,
  hash text not null,
  payload jsonb not null,
  ingested_at timestamptz not null default now(),
  primary key (wallet, signature)
);
alter table sat_chain_observations add column if not exists ingested_at timestamptz not null default now();
create table if not exists sat_chain_archive (
  wallet text not null,
  signature text not null,
  slot bigint not null,
  hash text not null,
  payload_gzip bytea not null,
  archived_at timestamptz not null default now(),
  primary key (wallet, signature)
);
create index if not exists sat_chain_archive_wallet_slot_idx on sat_chain_archive (wallet, slot desc);
create table if not exists sat_chain_interpretations (
  wallet text not null,
  signature text not null,
  parser_version int not null check (parser_version > 0),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (wallet, signature, parser_version)
);
create index if not exists sat_chain_observations_wallet_slot_idx on sat_chain_observations (wallet, slot desc);
create table if not exists sat_chain_trades (
  wallet text not null,
  signature text not null,
  payload jsonb not null,
  primary key (wallet, signature)
);
create index if not exists sat_chain_trades_wallet_time_idx on sat_chain_trades (wallet, (payload->>'timestamp') desc);
create table if not exists sat_trade_alert_outbox (
  wallet text not null,
  signature text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (wallet, signature)
);
create index if not exists sat_trade_alert_outbox_pending_idx on sat_trade_alert_outbox (created_at, wallet, signature);
alter table sat_ingestion_wallets enable row level security;
alter table sat_chain_observations enable row level security;
alter table sat_chain_archive enable row level security;
alter table sat_chain_interpretations enable row level security;
alter table sat_chain_trades enable row level security;
alter table sat_trade_alert_outbox enable row level security;

create table if not exists sat_alert_event_archive (
  id uuid primary key,
  payload bytea not null,
  archived_at timestamptz not null default now()
);
alter table sat_alert_event_archive enable row level security;
