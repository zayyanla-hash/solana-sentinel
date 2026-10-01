/**
 * Runtime schema used by PostgresDatabase.
 * Runtime bootstrap reflects the original v15 store migration plus later additive migrations.
 * New DDL belongs in a new migration; never edit an already-applied migration.
 *
 * JSONB payloads are the source of truth for round-trip fidelity with Zod types.
 * Legacy domain tables in 20260325000000_init.sql remain unused by the Node adapter.
 */
export const STORE_SCHEMA_VERSION = 3;

export const STORE_SCHEMA_SQL = `
create table if not exists sat_candidates (
  mint text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists sat_proposals (
  id uuid primary key,
  mint text not null,
  payload jsonb not null,
  created_at timestamptz not null
);
create index if not exists sat_proposals_created_idx on sat_proposals (created_at desc);

create table if not exists sat_orders (
  id uuid primary key,
  mint text not null,
  payload jsonb not null,
  created_at timestamptz not null,
  proposal_id uuid
);
create index if not exists sat_orders_created_idx on sat_orders (created_at desc);

create table if not exists sat_positions (
  id uuid primary key,
  mint text not null,
  payload jsonb not null,
  updated_at timestamptz not null
);

create table if not exists sat_portfolio (
  id int primary key default 1 check (id = 1),
  payload jsonb not null
);

create table if not exists sat_events (
  id uuid primary key,
  payload jsonb not null,
  created_at timestamptz not null
);
create index if not exists sat_events_created_idx on sat_events (created_at desc);

create table if not exists sat_token_risk (
  mint text primary key,
  payload jsonb not null,
  assessed_at timestamptz not null
);

create table if not exists sat_policies (
  mint text primary key,
  payload jsonb not null,
  assessed_at timestamptz not null
);

create table if not exists sat_scores (
  mint text primary key,
  payload jsonb not null,
  scored_at timestamptz not null
);

create table if not exists sat_research (
  mint text primary key,
  payload jsonb not null,
  generated_at timestamptz not null
);

create table if not exists sat_experiments (
  id uuid primary key,
  payload jsonb not null,
  created_at timestamptz not null
);

create table if not exists sat_signals (
  id uuid primary key,
  mint text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists sat_signals_mint_idx on sat_signals (mint, created_at desc);

create table if not exists sat_equity (
  id bigserial primary key,
  t timestamptz not null,
  nav double precision not null
);

create table if not exists sat_meta (
  k text primary key,
  payload jsonb not null
);

create table if not exists sat_alert_cooldowns (
  k text primary key,
  expires_at timestamptz not null
);

create table if not exists sat_alert_event_facts (
  id uuid primary key,
  payload jsonb not null
);

create table if not exists sat_schema_version (
  id int primary key default 1 check (id = 1),
  version int not null
);

alter table sat_orders add column if not exists proposal_id uuid;
create unique index if not exists sat_orders_proposal_id_uidx on sat_orders (proposal_id) where proposal_id is not null;
create index if not exists sat_orders_created_idx on sat_orders (created_at desc);
create index if not exists sat_events_created_idx on sat_events (created_at desc);
create index if not exists sat_signals_mint_idx on sat_signals (mint, created_at desc);

alter table sat_candidates enable row level security;
alter table sat_proposals enable row level security;
alter table sat_orders enable row level security;
alter table sat_positions enable row level security;
alter table sat_portfolio enable row level security;
alter table sat_events enable row level security;
alter table sat_token_risk enable row level security;
alter table sat_policies enable row level security;
alter table sat_scores enable row level security;
alter table sat_research enable row level security;
alter table sat_experiments enable row level security;
alter table sat_signals enable row level security;
alter table sat_equity enable row level security;
alter table sat_meta enable row level security;
alter table sat_alert_cooldowns enable row level security;
alter table sat_alert_event_facts enable row level security;
alter table sat_schema_version enable row level security;
`;
