-- Additive storage for the read-only finalized-chain monitor and durable INTERNAL alert gate.
-- Historical migrations remain unchanged after deployment.

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
  primary key (wallet, signature)
);
create index if not exists sat_chain_observations_wallet_slot_idx on sat_chain_observations (wallet, slot desc);

create table if not exists sat_chain_trades (
  wallet text not null,
  signature text not null,
  payload jsonb not null,
  primary key (wallet, signature)
);
create index if not exists sat_chain_trades_wallet_time_idx on sat_chain_trades (wallet, (payload->>'timestamp') desc);

create table if not exists sat_alert_cooldowns (
  k text primary key,
  expires_at timestamptz not null
);

create table if not exists sat_alert_event_facts (
  id uuid primary key,
  payload jsonb not null
);

alter table sat_ingestion_wallets enable row level security;
alter table sat_chain_observations enable row level security;
alter table sat_chain_trades enable row level security;
alter table sat_alert_cooldowns enable row level security;
alter table sat_alert_event_facts enable row level security;
