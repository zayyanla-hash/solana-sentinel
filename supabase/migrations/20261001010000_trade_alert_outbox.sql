-- Durable handoff from finalized classified trades to INTERNAL alert facts.
create table if not exists sat_trade_alert_outbox (
  wallet text not null,
  signature text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (wallet, signature)
);
create index if not exists sat_trade_alert_outbox_pending_idx on sat_trade_alert_outbox (created_at, wallet, signature);
alter table sat_trade_alert_outbox enable row level security;
