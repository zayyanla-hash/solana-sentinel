# Private read-only staging

This deployment runs one operator dashboard and one finalized-mainnet polling worker against PostgreSQL. It does not sign transactions, broadcast transactions, or execute trades. Production defaults to monitor-only. Paper research requires an explicit opt-in.

## Local setup

Use Node 20.12+ and pnpm 10.33.3. Install PostgreSQL 17+ first; on this Mac it is available at `/opt/homebrew/opt/postgresql@17/bin`. Other installations can set `SENTINEL_PG_BIN` to their PostgreSQL binary directory. The setup does not install or enable a global database service.

```sh
pnpm staging:start
pnpm build
```

The isolated cluster listens on `127.0.0.1:55432`. The application uses the non-superuser `sentinel_stage_app` role and the `sentinel_stage` database. Tests use the separate, disposable `sentinel_test` database. Passwords and operator tokens are generated locally in ignored files with restricted permissions. Do not copy those files into fixtures, reports, or Git.

Edit `.env.staging.local`: set `SENTINEL_MONITOR_WALLETS` to comma-separated public wallet addresses, or leave it empty and add wallets to the dashboard watchlist before starting the worker. Addresses are loaded at worker startup; restart it after changing the watchlist. The current local example uses a public transaction sample wallet; it is not identified as the operator's wallet.

Start these in separate terminals:

```sh
pnpm staging:monitor
pnpm staging:web
```

Open `http://127.0.0.1:4317` and sign in with the `SAT_API_TOKEN` from the private local configuration. The dashboard keeps the token in page memory. Signing out, reloading, or closing the page clears it. API subscriber keys do not authorize the global operator dashboard.

The public RPC endpoint is useful for a local pilot. Its observed rate limits and retained history constrain recovery; there is no service-level guarantee established here. Configure a suitable read-only RPC provider before relying on unattended operation. No Helius account is required for this polling path.

## Checks and a bounded pilot

```sh
pnpm staging:validate
pnpm evaluate:mainnet
python3 scripts/validate-staging.py --benchmark
pnpm staging:monitor --duration-ms=300000
```

The validation helper loads only the disposable test database URL; it does not import staging credentials or provider settings into the test suite. Database tests refuse nonlocal URLs or databases without `test` in their names. Normal `pnpm validate` without the test URL skips the optional PostgreSQL suites and reports those skips.

`/api/monitor` requires operator authentication. It shows committed observations, unknown/failed outcomes, pending alerts, coverage and the age of the last head observation. `CURRENT` means caught up to the worker's saved bounded bootstrap boundary; it does not establish complete lifetime history. Operational health requires current coverage, no stored poll error, no alert backlog, and a head observation within two minutes. A stopped worker therefore becomes degraded even if the web server remains available.

For a longer pilot, choose an appropriate provider and continuously supervise the worker and database on an always-on host. Save logs with rotation and measure uptime, stale intervals, raw outcomes, queue depth, recovery time, memory and unexpected exits. The short local runs in this branch do not establish a seven-day reliability result.

## Interpretation and alerts

The journal stores raw finalized transactions, including failed and unknown observations. It supports direct native transfers, isolated recognized Jupiter token routes and one narrowly evidenced Jupiter/Pump sale through a temporary wrapped-SOL account. Unsupported combinations abstain. Incoming activity visible only through a token account is outside the current address-accountKeys scope.

Journal-derived wallet observations have no verified price or cost basis. Scoring reports insufficient evidence rather than inventing profit or historical prices. Signal and backtest paths require dated same-mint evidence and reject unavailable live history.

Create tracked-wallet buy/sell rules in the Alerts tab. Classified live trades enqueue alert work in the same transaction as their facts and checkpoint. The worker persists a deterministic event per trade/rule before acknowledging that work. Rules created after a historical transaction do not create retrospective notifications. Cooldowns and inbox facts survive restart. The internal inbox is the supported delivery channel; external channels never report delivery without an implementation.

Raw observations and pending alert intents have explicit capacity limits. Durable alert facts have a 100,000-row limit; the visible inbox holds 500 entries. At capacity, processing fails closed and requires an operator retention/archive plan. Do not delete idempotency facts while their work can still replay.

## Backup and restore

Stop the worker before creating a consistent comparison backup. Keep the dashboard read-only during the check.

```sh
pnpm staging:backup
pnpm staging:restore-check
```

The restore check restores into a new disposable database, compares every public table's row count and content hash against the quiescent staging database, then removes the disposable database. The backup is stored locally under ignored `runtime-history/staging-postgres/`; it is not an off-machine disaster-recovery policy.

Stop the cluster after stopping the web server and worker:

```sh
pnpm staging:stop
```

## Before external deployment

Use a private single-operator deployment with an explicit origin allowlist, HTTPS termination, secured operator tokens, verified database TLS, and a database role appropriate for the migrations. Apply the additive monitor/outbox migrations after a backup. Process-local API quotas do not enforce a shared limit across multiple web instances; the global dashboard state is not multi-tenant.

Review and expand the small transaction corpus across protocols and edge cases. The classifier was improved using that corpus, so its replay is regression evidence rather than an independent accuracy estimate. Establish a holdout set and a sustained pilot before describing the system as production-ready.

Parser upgrades need an explicit versioned replay/migration policy: existing immutable observation hashes intentionally reject changed facts instead of silently reinterpreting committed history. No automatic historical reclassification is provided.
