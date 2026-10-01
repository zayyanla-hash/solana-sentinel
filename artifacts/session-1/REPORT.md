# Solana Sentinel — Session 1 engineering report

Date: September 30, 2026 (America/Los_Angeles). Scope: architecture and reliability hardening of the local contributor checkout. Sessions 2 and 3 have not been executed.

## 1. Executive summary

The working batch ingestion path now has bounded HTTP requests, retries, response sizes, pagination, concurrency and explicit completion diagnostics. Optional durable history preserves classified observations across refreshes and controlled restarts, suppresses identical replays, and rejects contradictory evidence. Parser defects and a paper-accounting concurrency defect were reproduced and corrected.

Validation passed: **273 tests passed, 2 dedicated Postgres tests skipped, 26 test files**; workspace typecheck, lint, builds and secret scan passed. This is a local engineering checkpoint, **not a production release**. Real stream reconnects, mainnet classification accuracy and a live Postgres round trip remain unverified. Live signing, broadcasting and real-money execution were not added.

## 2. Repository findings and selected intervention

The source project mirror was empty. The clean local checkout at `2f0a583c1639b47a8f0c87d57fb9fa640f911203` contained the earlier contributor packages. The existing checkout and owner main branch were preserved. Work is isolated on `hardening/ingestion-reliability-20260930`.

Upstream was checked read-only and is reachable: main remains `ca483ad360ad515c6793f85a1abc0f479ef0a643`; its contributor branch points to `c13a27d5cce78e6383fd207c880409553c7c8d1e`. The five earlier local contributor commits and this session's commits were not pushed.

Actual flow:

```
CLI / web / one-pass worker
  -> provider selection
  -> Helius Parsed Events history (Enhanced compatibility fallback)
  -> bounded request + page validation + signature validation
  -> per-transaction normalization and conflict quarantine
  -> wallet-perspective classification
  -> optional local durable history archive
  -> wallet scoring / research state
```

The Helius stream class opens no socket. Its former reconnect timer did not reconnect, and injected fixtures could make its health appear healthy. Subscriptions now fail explicitly with `helius-stream-not-implemented`; health remains unavailable. The worker remains a single batch pass, not an unattended streaming service. No new distributed queue or transport was invented.

Two distinct paper proposals previously could read one cash snapshot, both commit orders, and overwrite each other's portfolio updates. A concurrent mark and fill had the same risk. Production fill and mark paths now compare the expected portfolio and positions inside a serialized write. PostgreSQL uses the same locked portfolio row and transaction for both paths. Stale work fails before ledger writes; its caller must explicitly re-evaluate.

See [forensics.md](forensics.md) for the broader architecture map, code references and unresolved findings. It distinguishes baseline observations from corrected behavior.

## 3. Changes made

| Component | Change and purpose |
|---|---|
| `packages/solana/src/http.ts` | Header/body deadlines, streamed byte cap, finite option validation, bounded retries/backoff/jitter/capped Retry-After, immediate cancellation and safe errors. Retries network/timeouts and HTTP 408/429/5xx; never retries auth or malformed JSON. |
| `parsed-events.ts`, `history-types.ts` | Paginated bounded reads, strict network signature checks (base58 decoding to 64 bytes), per-row rejection, conflicts, chronological results, coalescing, max 32 concurrent requests, diagnostic status/counters. Compatibility fallback is restricted to parsed endpoint 401/403/404; valid empty or uncertain data does not trigger another provider. |
| `normalize.ts` | Reject malformed transfer containers/fields, invalid raw amounts/decimals and unknown status; correct millisecond timestamps; deterministic full-mint leg IDs; identical duplicate suppression and conflicting-fact quarantine. Invalid rows return null for explicit rejection by the provider. |
| `durable-history.ts`, `wallet-history.ts` | Opt-in single-writer archive using exclusive ownership, bounded records/bytes/pending work, checksummed snapshots, temp-file fsync, atomic rename and directory fsync. Partial classified observations persist without advancing the complete trade checkpoint. Failed reads return explicitly stale saved evidence. |
| `packages/database`, pipeline fill/mark | Required expected state for atomic fills, explicit `StalePortfolioError`, atomic mark/positions/equity updates, transactional rollback and same-proposal idempotency. |
| On-chain / market providers | Configured real adapter failures no longer return clean demo risk profiles or hidden demo asset/OHLCV values. Explicit demo adapters remain available. Helius RPC uses bounded JSON transport; other active HTTP adapters have request deadlines. |
| `jupiter-token.ts`, system health | Require exact requested mint, retain missing/invalid organic score as unknown, sanitize errors. Unobserved keyed providers report degraded rather than presumed healthy; Helius records observed request outcomes. |
| CLI / worker / stream | Stop provider admission on signal, cancel command-owned live history, close providers before database teardown, preserve signal exit status. Hosts calling process.exit release writer ownership without publishing unfinished temp files. Stream stub capabilities are explicit. |
| Test harness / scripts | Dedicated opt-in PG test URL, visible skipped tests, real Response mocks, corrected timestamp-sensitive assertion, `pnpm validate`, reproducible synthetic benchmark. |

`SAT_HISTORY_DIR` enables durable history for keyed live history providers. Default storage remains unchanged. Use an ignored local directory such as `runtime-history/`. One process may own a directory at a time; a second writer fails explicitly. Do not point destructive PG tests at a production/application database.

## 4. Tests added and regression proof

**79 tests added** across nine files:

- `normalization-reliability.test.ts` (23): raw quantities, decimal boundaries, malformed data, timestamps, unknown/failed status, invalid siblings, full-mint identity, duplicate conflicts.
- `history-http.test.ts` (17): transient and sustained HTTP failures, retry caps, malformed/oversized responses, stalled real response bodies, real local 429 recovery, pagination/cycles/caps, invalid signatures, parser uncertainty, concurrent admission and cancellation.
- `durable-history.test.ts` (16): replay/restart, partial progress, chronological merging, defensive copies, interrupted write, corrupt state, altered evidence/side/mint, capacity, single-writer ownership and shutdown with work in flight.
- `concurrent-portfolio.test.ts` (7): actual production fill/fill and mark/fill races, stale positions, required expected state, explicit fresh retry, and PostgreSQL query ordering/rollback using a mocked client.
- `provider-evidence.test.ts` (7), `provider-fail-closed.test.ts` (3): unknown readiness, exact metadata identity, malformed metadata, no hidden clean/demo fallbacks.
- `history-process.test.ts` (3): real child-process SIGTERM restart, host process.exit restart, and SIGKILL before rename with preserved prior data and explicit orphan-lock failure.
- `stream-health.test.ts` (2): unavailable stub and explicit demo heartbeat shutdown.
- `cli-shutdown.test.ts` (1): actual CLI process, stalled local Helius-shaped body, SIGINT, exit 130 and writer-lock removal.

A separate replay of 37 regression assertions against original source aliases produced **31 failures and 6 passes**. These are assertion counts, not 31 independent bugs. The production accounting cases both committed against the baseline and only one commits on the guarded branch. Malformed data, false readiness and metadata identity defects also reproduced. Raw evidence: [regressions-original-baseline.json](regressions-original-baseline.json). New APIs naturally do not exist on that baseline; their missing-method failure is not counted as a pre-existing implementation defect.

## 5. Validation evidence and reproduction

Environment: Node v26.9.0, pnpm 10.33.3, Darwin 24.3.0, arm64, Apple M3, 8 logical CPUs.

Commands executed from the isolated checkout:

```bash
CI=true npx --yes pnpm@10.33.3 install --frozen-lockfile
pnpm validate
pnpm exec vitest run --reporter=json --outputFile=artifacts/session-1/tests-final.json
pnpm benchmark:ingestion --events=5000 --runs=5 --output=artifacts/session-1/benchmark-final.json
node node_modules/eslint/bin/eslint.js scripts/benchmark-ingestion.ts --max-warnings 0
git diff --check
```

`pnpm validate` runs workspace typecheck, root and web lint, tests, package/web/worker builds and basic secret scan. Exit 0. Tests: 273 passed / 2 skipped / 275 total, 26 files. No warnings in lint; builds passed; no high-confidence secret patterns found. Raw log: [validate.log](validate.log); machine-readable tests: [tests-final.json](tests-final.json).

The initial baseline reported 196 passing tests in 17 files. Its two PG tests could silently return early when the database was unavailable. This session makes them visibly skipped unless `SENTINEL_TEST_DATABASE_URL` is supplied; an explicitly configured database failure now fails the tests. No dedicated PG test service was configured, and no live database claim is made. The system pnpm 11 wrapper initially attempted dependency reinstallation and failed its build-policy check; pinned pnpm 10.33.3 recovered installation. No lockfile or dependency policy changes were retained.

Original regression replay used a temporary Vitest config mapping source aliases to the unchanged initial checkout. To reproduce portably, create an isolated worktree at `2f0a583`, replace each `@sat/*` alias prefix in the new checkout's Vitest config with that baseline directory, and run the three regression files named above. That command is expected to fail against original source. Initial reported counts are preserved in [baseline.json](baseline.json).

UI browser E2E tests were not run; this session changed backend interpretation/storage/lifecycle and validated the web through typecheck, lint and production build. PostgreSQL query-order tests use a mock client and do not establish live isolation or server behavior.

## 6. Performance evidence

Code checkpoint: `990977b24f8bdc6665d3942717208e13d4b44065`. Five runs of **5,000 synthetic USDC-to-token transactions**, after 100 warmups, followed each time by duplicate replay/deduplication. No API calls, signatures from mainnet, protocol corpus or mainnet latency are represented. Throughput includes duplicate suppression; per-event latency measures normalization/classification and excludes acquisition/network/storage.

| Run | Unique events/s | p50 ms | p95 ms | p99 ms | Duplicates suppressed |
|---|---:|---:|---:|---:|---:|
| 1 | 59,257 | 0.01108 | 0.02400 | 0.08562 | 5,000 |
| 2 | 73,076 | 0.01083 | 0.01496 | 0.04492 | 5,000 |
| 3 | 79,913 | 0.01012 | 0.01208 | 0.03808 | 5,000 |
| 4 | 85,258 | 0.00975 | 0.01121 | 0.03492 | 5,000 |
| 5 | 88,337 | 0.00967 | 0.01150 | 0.01675 | 5,000 |

Local archive experiment: 5,000 unique classified observations, 32 simultaneous callers for one wallet, **one upstream fixture call**, first fsync/rename publication **317.26 ms**, controlled reopen/replay **208.78 ms**, zero additional unique records from replay. Reopen was a new provider instance; separate child-process tests prove process restart boundaries.

RSS start/end/max sampled: **85.95 / 274.91 / 274.91 MiB**. There was no forced GC or long soak. The 32-caller experiment deliberately makes defensive result copies; the measured memory increase includes caller-owned snapshots. These measurements do not prove a stable long-run memory plateau. Configured archive/admission limits are separately exercised by tests.

These are one machine's repeated synthetic runs, not a speedup claim or protocol correctness measurement. Warmup/noise produce noticeable variance. Full conditions/CPU/memory/raw timings: [benchmark-final.json](benchmark-final.json). Earlier measurements are preserved separately and are not blended.

## 7. Reliability matrix

| Failure/scenario | Observed behavior | Evidence / scope |
|---|---|---|
| Duplicate / concurrent duplicate | One normalized signature; one archive leg; coalesced fetch | Provider/store tests, 32-caller fixture burst |
| Contradictory signature facts or changed leg identity | Quarantine/reject; prior archive stays intact | Provider conflict and archive side/mint tests |
| Transient 429/5xx | Bounded retry; observed recovery | Mock responses and real local HTTP server |
| Persistent HTTP failure | Retry exhaustion explicit; prior history explicitly stale | HTTP and archive tests |
| Stalled response body / malformed / excessive bytes | Deadline/rejection, no fake success | Real local HTTP tests |
| Pagination cycle, cap, full page without cursor | PARTIAL; not FRESH/complete | Provider tests |
| Parser/transaction unknown or failed | No BUY/SELL from failed/unknown; diagnostics retained | Parser and provider tests |
| Out-of-order observations | Deterministic timestamp ordering and merge | Store and existing FIFO tests; no within-slot causal-order claim |
| Controlled SIGTERM / CLI SIGINT / host process.exit | Writer released; saved snapshot survives; restart replay dedupes | Actual child/CLI process tests |
| SIGKILL before rename | Prior file survives; orphan lock blocks automatic restart | Actual child process; manual test-only recovery after child death |
| Interrupted write / corrupt committed file | No success acknowledgment; old file retained / corruption explicit | Filesystem fault-injection tests |
| Capacity/burst saturation | Explicit admission or retention error; no silent eviction | Store/provider cap tests |
| Concurrent distinct fill / mark plus fill | One commit, one explicit stale rejection | Production entry tests; mocked PG transaction tests |
| WSS disconnect/reconnect/gap repair | Unsupported: no real stream adapter | Source inspection and explicit unavailable stub tests |

## 8. Remaining ranked backlog and limitations

**P0 data-loss risk (source-supported, live PG reproduction pending):** `PostgresDatabase.writeIntel` still reads/replaces a shared JSONB blob without a row-lock/version boundary. Concurrent updates can lose watchlist/score/rule/backtest fields. Pipeline read-modify-write of the same collection can also lose updates. Atomic per-field/per-item mutations and cap-boundary concurrency tests are needed. The new history archive does not fix this separate research database path.

**P1:**

1. Real wallet-flow signals need per-mint, timestamped BUY evidence. Current global credibility scores can be reused for unrelated assets; those labels are not evidence of actual flow.
2. Strategy Lab still fabricates confirming-wallet inputs and can synthesize unavailable bars without full provenance. Its missing SOL fallback can use target bars as benchmark. Do not treat those results as real strategy evaluation.
3. Real WSS ingestion/reconnect/backfill is absent; no read-only mainnet soak or independent labeled corpus has been measured.
4. Hard-crash writer locks require manual recovery after confirming the old process is dead. Do not blindly delete a live process's lock. There is no automatic crash-lock takeover or cross-host archive support.
5. Alert creation still acknowledges before awaiting persistence; stored rules are not restored into the process-local alert engine, and external channels remain stubs.
6. API entitlement/rate-limit identity trusts development headers and process-local counters; authenticated deployment gates and bounded/durable quotas remain unfinished.
7. Live Postgres concurrency/rollback/restart verification remains outstanding. Generic low-level portfolio setters remain public; external callers must not bypass the new fill/mark unit-of-work boundary.

**P2:** full provider telemetry/freshness, atomic Postgres cold-start bootstrap, separating state-seeding from anonymous GET, bounding all unrelated process-local maps, provenance-bearing bars, retention maintenance and repeated longer burst/soak measurement.

Other boundaries: the archive stores classified trade observations, not every raw/failed/unknown transaction; `tradeHighWater` is a trade watermark, not a Solana slot cursor or proof of gap-free history. Refreshes re-fetch bounded recent history and report cap exhaustion; a long outage can exceed that window. Completion requires the bounded page traversal to finish without uncertainty. Exactly-once external alert delivery/outbox is not implemented. Quantities remain JavaScript numbers and a dust threshold; arbitrary-precision account balance interpretation is not established. Equal-time ordering is deterministic, not independently proven within-slot chronology. Complex account closure/rent, raw RPC balance reconstruction, WSOL routing and independent mainnet protocol semantics require Session 2 fixtures. Only the listed Node environment was tested.

## 9. Recommended next session

Build a sanitized, reproducible real-transaction evaluation corpus with explicit wallet perspective and independent labels. Preserve a pre-change baseline, then prioritize false BUY/SELL interpretations and asset-specific wallet evidence. Prefer a small defensible corpus to an invented 200–500 sample result. Keep all mainnet interaction read-only and signing/broadcast disabled. Pair this with live isolated-Postgres concurrency tests before a production claim.

## 10. Checkpoints and handoff

- `767b1c7` — required portfolio CAS for paper fills and atomic marks; explicit PG test opt-in.
- `4df3546` — bounded/paginated ingestion, conservative normalization/provider behavior, optional durable history, measurement and validation entry points.
- `990977b` — command-owned read cancellation and exit-lock lifecycle regressions.
- A final evidence-only checkpoint records this report and raw validation results; see `git log` for its hash.

Branch: `hardening/ingestion-reliability-20260930`. The original checkout remains clean. A local Git bundle contains the complete branch history for review/fetch; no PR, remote push, merge or production replacement was performed.
