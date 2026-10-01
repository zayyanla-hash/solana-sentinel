# Session 1 engineering forensics

Scope: local checkout only. Source inspection, no live credentials, network calls, signing, broadcast, or trading.

## Initial runtime map at 2f0a583

- `apps/web/src/app/api/state/route.ts` exposes dashboard state and mutations; `apps/web/src/lib/api-v1.ts` exposes versioned resource endpoints. Both call `@sat/pipeline`.
- `apps/worker/src/index.ts:17-45` runs one discovery/research/experiment pass and exits. It is not a scheduled or continuous ingestion service.
- `packages/pipeline/src/providers.ts:19-32` caches market, on-chain, execution, research, and wallet-history adapters per process. With keys unset, the corresponding demo providers are used.
- `packages/pipeline/src/index.ts:82-93,129-281,284-412` runs discovery, proposal evaluation, and paper fills. `packages/database/src/index.ts:166-180` selects process-local memory or Postgres. `packages/database/src/postgres.ts:390-466` commits a paper fill as one transaction.
- `packages/execution/src/index.ts:141-231` performs Jupiter GET quote/route only. `packages/shared/src/schemas.ts:265-272` requires `canBroadcast: false`; `packages/pipeline/src/index.ts:63-68` remaps LIVE to PAPER. No signer or transaction broadcast path is wired in the inspected application path.
- `packages/streaming/src/index.ts:178-210` is an explicit disconnected Helius stream stub: subscriptions are empty and health reports `connected: false`. `packages/alerts/src/index.ts:147-155` registers an internal inbox and external stubs, not delivery integrations.

## Ranked findings and backlog

### P0 — paper fills from different proposals could overwrite each other (guard added)

`executePaperProposal` computes a new portfolio from a snapshot read before the quote (`packages/pipeline/src/index.ts:293-337,376-404`). Two distinct proposals could use the same cash and positions. The old per-proposal compare-and-swap prevented duplicate fills of one proposal but did not serialize different proposals before replacing all positions and the portfolio (`packages/database/src/postgres.ts:390-466`; `packages/database/src/index.ts:101-129`). A concurrent JUP and JTO fill could leave two orders with only one position and one debit. The fill boundary now compares the expected portfolio and position set before writing; Postgres locks the portfolio row. A stale request fails explicitly and must be recomputed by its caller. Same-proposal `AlreadyExecutedError` remains a separate invariant. `markToMarket` uses the same state check and transaction boundary for positions, portfolio, and equity (`packages/pipeline/src/index.ts:416-433`; `packages/database/src/postgres.ts:466-515`). The generic setters remain public for compatibility and do not provide this atomic boundary.

### P1 — wallet signals assert asset-specific flow without asset-specific wallet evidence

`generateSmartMoneySignals` passes the same global wallet-score list into every asset calculation (`packages/pipeline/src/intelligence.ts:85-123`). `buildSentinelSignals` filters only by wallet score, confidence, and sample size, then emits “accumulated” and “flow” explanations for the current asset (`packages/signals/src/sentinel.ts:30-31,49-79,92-133`). Reproduce with wallets whose observed BUYs are solely in mint A and positive momentum for mint B: a wallet-entry signal can be emitted for B. Require timestamped per-mint BUY evidence and distinct-wallet checks before these signal types; suppress when unavailable.

### P1 — configured real providers hid missing data behind demo fixtures (fallback removed)

The Birdeye adapter returned deterministic demo OHLCV or a demo asset for a known fixture mint after a configured provider failure; Helius returned a clean demo token-risk profile on the same condition (`packages/market-data/src/index.ts:198-252`; `packages/solana/src/index.ts:222-310`). In a keyed run, this could make missing real evidence appear live. The real adapters now return `null`/`[]`/`UNKNOWN_ONCHAIN_RISK`, while the explicit demo adapters remain available. The downstream strategy lab still synthesizes history independently (next finding).

### P1 — Strategy Lab can label synthetic or assumed inputs as non-demo

When market OHLCV is empty, `runStrategyLab` synthesizes 180 demo bars (`packages/pipeline/src/intelligence.ts:141-150`) but sets `isDemo` using only asset/provider flags (`:171`). It also hardcodes `confirmingWallets: 2`, `walletCredibility: 72`, and uses the target asset's bars as a SOL benchmark if SOL is missing (`:151-172`). Reproduce with a keyed provider returning no bars for a non-demo asset. Fail with an insufficiency result or carry explicit synthetic provenance through the result; use observed wallet evidence and an actual benchmark or mark it unavailable.

### P1 — intel persistence loses concurrent updates

Postgres stores watchlist, wallet scores, signals, alert rules, and backtests in one `sat_meta` JSONB payload. `writeIntel` reads then replaces that whole payload without a lock or version check (`packages/database/src/postgres.ts:220-236,494-511`). Two concurrent writes to different fields can erase one another. Watchlist add/remove also reads the list, checks the cap, then replaces it (`packages/pipeline/src/intelligence.ts:205-236`); parallel adds can exceed the cap or lose an item. Use a transaction with row lock or separate tables and atomic insert/delete plus a cap constraint. Cover two writers and a cap-boundary race.

### P1 — alert creation can report success without a durable or active rule

`createAlertRule` returns immediately while `db.addAlertRule` is fire-and-forget (`packages/pipeline/src/intelligence.ts:178-199`). A rejected write does not reach the HTTP caller; after restart, `getAlertEngine` creates an empty process-local engine and does not hydrate stored rules (`:34-38`). The only other emit call is a test helper (`:201-203`). Make rule creation async and await storage, hydrate rules at startup, and wire actual triggers before describing continuous alerts.

### P1 — public API limits and tiers rely on request-controlled or process-local state

With `SAT_API_KEYS` unset, the API accepts the caller's `x-sentinel-tier` header (`apps/web/src/lib/api-v1.ts:79-84`). Its rate-limit identity comes directly from `x-forwarded-for` (`:52-56`), and quota/rate buckets live only in process memory (`packages/entitlements/src/index.ts:123-133`; `packages/observability/src/index.ts:81-96`). A remote deployment with omitted keys can claim PRO/ADVANCED; a client can rotate forwarded IPs, and multi-worker counts diverge. Require trusted principal and proxy-derived identity for non-loopback service. Apply durable distributed quotas if monetized. `maxBacktestsPerDay` is declared but has no enforcement path (`packages/entitlements/src/index.ts:10-58`; `apps/web/src/lib/api-v1.ts:183-196`).

### P2 — health reported configuration, not provider readiness (default corrected)

`getSystemHealth` marks every keyed provider healthy based on `isDemo=false`, with null error, latency, and age fields (`packages/pipeline/src/index.ts:466-502`). Expired credentials or provider outage can still yield a healthy response before a request exercises the adapter. The hardening branch now reports unobserved keyed providers as degraded and records real Helius RPC request status. Complete telemetry coverage and age-based degradation for all adapters remain follow-up work.

### P2 — reads can create expensive state and Postgres cold starts can race

On an empty public-demo database, `GET /api/state` starts a full research pass and writes candidates/experiments (`apps/web/src/app/api/state/route.ts:31-38`). Parallel anonymous reads can repeat external work and interleave state. Use an explicit seeded worker action with a single-flight lock. Separately, Postgres bootstrap checks for an empty portfolio then inserts without a transaction or conflict clause (`packages/database/src/postgres.ts:102-122`); two cold workers can make one startup fail. Make the initialization idempotent and atomic.

### P2 — entitlement presentation is ahead of enforcement

`/api/v1/opportunities` returns current candidates/scores while reporting only `delayedMinutes` as a number (`apps/web/src/lib/api-v1.ts:106-119`); it does not delay the feed. The configured backtest/day caps and `advancedSignals`/`realtimeAlerts` booleans are likewise not enforced at resource boundaries (`packages/entitlements/src/index.ts:10-58`; `apps/web/src/lib/api-v1.ts:121-198`). Either implement those gates or label the tier table as proposed capability.

## Validation gaps to keep visible

- The existing same-proposal concurrent tests cover idempotency, not different-proposal portfolio consistency (`tests/redteam-fixes.test.ts:156-175`; `tests/persistence.test.ts:310-427`).
- The original Postgres persistence tests returned early and counted as passing when the database was unavailable (`tests/persistence.test.ts:193-216`); a green unit run alone does not establish a live Postgres round trip.
- Alert tests exercise an in-memory engine directly, not restart hydration or trigger delivery (`tests/sentinel-v3.test.ts:161-193`).
- Demo backtest tests use explicit synthetic bars; they do not exercise a keyed provider with unavailable history (`tests/sentinel-v3.test.ts:88-159`).

## Validation harness correction

The hardening branch gates destructive Postgres reset tests on `SENTINEL_TEST_DATABASE_URL`, never on the application `DATABASE_URL`. With the dedicated test URL unset, two tests are visibly skipped. With it set, a connection error fails rather than hiding the failure. No live database round trip was performed in this session.
