# Solana Sentinel: private staging and mainnet interpretation

September 30, 2026, America/Los_Angeles. Artifacts use UTC timestamps on October 1. Engineering checkpoint: `8367e6e`, on `hardening/ingestion-reliability-20260930`. The original checkout and synced project sources were preserved.

## 1. Executive summary

Sentinel now has a continuous read-only polling worker backed by a PostgreSQL journal. Raw observations, classified trade effects, alert intents and cursor changes commit together. Interrupted work resumes from durable progress; conflicts and uncertain history fail closed. The private production dashboard requires operator authentication, defaults to monitor-only and exposes coverage, freshness and alert backlog.

The final local validation passed **354 tests in 35 files**, including the PostgreSQL suites, plus typecheck, lint, production build and the basic secret scan. Browser checks verified the private operator flow and the existing explicit demo/paper flow. A local backup restored into a disposable database with matching table counts and content hashes.

Production readiness remains partial. The reviewed corpus has 13 public finalized transactions with only one defensible directional case, used during implementation. The two mainnet runs were bounded to five and three minutes. Neither establishes broad classification accuracy or long-duration availability. No external hosting or provider account was provisioned.

## 2. Repository findings and implementation

| Finding | Change and practical result |
|---|---|
| Concurrent intelligence updates could replace another process's JSONB fields. | PostgreSQL mutations lock the intelligence row and update only their field. Watchlist admission, wallet scores, rules, backtests and alert state survive concurrent writers. |
| The previous local archive retained trades rather than every raw outcome. | The new PostgreSQL journal retains finalized raw observations, including unknown and failed transactions, with immutable hashes and a separate trade table. |
| Trade observations lacked a transactionally coupled continuous cursor. | A bounded polling state machine atomically commits observations and cursor progress. An initial recent window is explicit; catch-up preserves its target and cursor across restarts. |
| Alert history and cooldowns could disappear on restart, and cached API history could hide another process's events. | Durable event facts, cooldowns and an atomic trade-alert outbox support idempotent internal delivery. Read endpoints use fresh database snapshots. |
| A completed old catch-up target could appear fresh. | The checkpoint preserves when the target head was observed. Completion retains that age; stale history does not become fresh just because processing finished. |
| Wallet credibility summaries could imply asset-specific confirmation without transaction evidence. | Signals require dated same-mint buys, real source signatures, positive quantities and sufficient classification confidence. Repeated signatures and known wallet clusters do not inflate confirming groups. |
| Live backtests could use generated bars, substitute target bars for SOL, or backdate current risk. | Missing live history produces explicit insufficiency. Historical flow and dated risk are required; unavailable benchmarks remain unavailable. Demo assumptions stay labeled. |
| Global state mutation could accept subscriber credentials or client-selected tiers. | The operator dashboard uses only the configured operator token. Subscriber tiers come from server key configuration, and forwarded headers do not choose a quota principal. Production blocks paper/research actions until explicitly enabled. |
| Remote database TLS could omit certificate verification. | Remote pools default to verified TLS; loopback stays plaintext. Explicit opt-outs are visible configuration choices. |

The main changes are in `packages/database`, `packages/solana/src/rpc-reader.ts`, `packages/pipeline/src/monitor.ts`, `journal-history.ts`, `intelligence.ts`, the signals/backtest packages, `apps/worker/src/monitor.ts`, and the protected web routes/dashboard. New migrations are additive. CI now configures the dedicated PostgreSQL test URL rather than injecting a global application database into ordinary unit tests; hosted CI has not been run here.

## 3. Interpretation algorithm and measured corpus

The initial raw-RPC interpreter accepted fee-adjusted direct SOL transfers and isolated recognized Jupiter token routes. It verified the transaction identity, finalized history metadata, wallet account role, route authority and changed token-account ownership. Native rent, account closure and combined actions abstained. The existing Helius path remains available separately.

The baseline was recorded before the native-sale fix. Evidence labels identify account/instruction/balance paths and explorer links. The added path requires a single Jupiter route, one Pump `sell_v2` call with its exact instruction discriminator, amount and account roles, an exact wallet-owned token debit, a temporary WSOL account created and closed back to that wallet, and consistent fee/native balance accounting. Extra sales, altered authority, wrong amounts, wrong mint/owner, unrelated transfers and missing proofs abstain. The discriminator/account layout was checked against the [official Pump IDL](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json), and the quote behavior against the [official sell instruction documentation](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/SELL.md).

| Metric | Before | After |
|---|---:|---:|
| Captured finalized transactions | 13 | 13 |
| Classified directional transactions | 0 | 1 |
| Successful ambiguous/unsupported transactions retained as UNKNOWN | 9 | 8 |
| On-chain failed transactions retained as FAILED | 4 | 4 |
| Correct directional cases in the reviewed directional subset | 0/1 | 1/1 |
| False BUY / SELL in that subset | 0 / 0, with no predictions | 0 / 0, with one prediction |
| Ambiguous cases excluded from directional metrics | 8 | 8 |

There are no reviewed BUY cases. UNKNOWN is an abstention policy label, not proof that no swap occurred. All 13 records match their final policy labels, but overall accuracy remains `null`. The one supported sale was used to improve the parser; its replay is a regression test, not an independent holdout. This sample does not establish Raydium, Orca, Meteora, broad PumpSwap, transfer-fee token or general multi-hop coverage.

Public RPC acquisition failures were preserved in the two source artifacts. The collector requested 18 recent program signatures and acquired 13 transactions; the remaining five attempts failed. Selection was by a public Jupiter-program sample and fee-payer perspective, not a random wallet study. Source data, baseline labels, exclusions and predictions are retained in [mainnet-labels.json](mainnet-labels.json) and [mainnet-evaluation.json](mainnet-evaluation.json).

## 4. Reliability matrix and tests

| Scenario | Expected behavior | Observed result |
|---|---|---|
| Same observation replayed / concurrent competing cursor writes | No duplicate facts; stale writer rejected | Live PostgreSQL tests pass; 200/200 benchmark replays suppressed. |
| Cursor update fails after facts are inserted | Whole page rolls back | Injected PostgreSQL trigger failure leaves facts, trades and checkpoint unchanged. |
| Process killed before / after commit | No partial commit; committed facts survive reopen | Actual child-process SIGKILL tests pass at both boundaries. |
| Missing transaction, signature mismatch, dropped anchor or pagination cycle | No invented completion | Monitor tests preserve the cursor and report failure/degradation. |
| Previously empty wallet receives a burst | Traverse to a real boundary | The first populated page is not silently accepted as full coverage. |
| Slow catch-up spans cycles and process reopen | Retain target observation age | Clock-controlled and live PostgreSQL reopen tests pass. |
| Alert persisted but outbox acknowledgement interrupted | Replay one durable event ID | Injected pre-ack interruption and reopen/replay retain one inbox fact. This is not an actual SIGKILL external-delivery experiment. |
| Cooldown/history rotates or another process emits | Preserve cooldown/idempotency; read current inbox | Live PostgreSQL tests and API regressions pass. |
| Outbox or durable event facts fill | Reject new work without deleting replay identities | Capacity tests pass; existing event IDs remain idempotent at capacity. |
| Unconfigured external alert channel | No fake delivery | Persisted events report `delivered:false` with an explicit reason. |
| Unkeyed/wrong-key production access or paper action in monitor-only | Deny access/action | Built server returns 401 for anonymous state/monitor reads and 403 MONITOR_ONLY for bootstrap. |
| Paper demo duplicate execution / hostile origin | Reject second effect / request | Browser/API check returns 400 for duplicate execution and 403 for hostile origin; live flags remain false. |

New regression files include `atomic-intelligence`, `ingestion-postgres`, `polling-monitor`, `trade-alert-outbox`, `alert-persistence`, `deployment-guards`, `rpc-reader`, `mainnet-rpc-replay` and `signal-provenance`. Existing persistence and paper-demo tests were retained; the browser demo now explicitly initializes its fixtures.

## 5. Validation evidence

Executed from the isolated worktree:

```sh
python3 scripts/validate-staging.py
# pnpm validate: typecheck, lint, tests, package/web/worker build, basic secret scan
# 35 test files passed; 354 tests passed; no PostgreSQL skips in this run
node node_modules/eslint/bin/eslint.js scripts/benchmark-monitor.ts scripts/collect-mainnet.ts scripts/evaluate-mainnet.ts --max-warnings 0
node --import tsx scripts/evaluate-mainnet.ts
node --env-file=.env.staging.local --import tsx scripts/benchmark-monitor.ts --events=200
python3 scripts/staging-db.py backup
python3 scripts/staging-db.py restore-check
git diff --check
```

The validation helper passes only the disposable test URL. Full output is in [validate-release.log](validate-release.log). Earlier failed/partial collection and typecheck attempts are retained in `initial-tests.json` and `validate-initial.log`; subsequent passing logs are preserved separately.

The production-mode browser checks used the built app. Private staging required masked operator sign-in, hid paper initialization, showed stopped-worker staleness and created two live journal rules. A separate in-memory process with explicit demo/paper opt-in verified initialization, SCAMX rejection, WIF paper fill, duplicate rejection, wallet/lab panels and a demo alert rule. [Operator evidence](browser-operator-check.json), [API evidence](staging-api-check.json), [demo evidence](browser-demo-check.json) and screenshots are retained. The Playwright CI command itself was not run locally; these browser checks used the production server rather than the CI development server.

Generated staging credentials were checked against every saved artifact and fixture; none were present. The basic pattern scan passed. This is not a third-party security audit or a full dependency vulnerability assessment.

## 6. Measured performance and short mainnet operation

Environment: Apple M3, macOS arm64, Node 26.9.0, PostgreSQL 17.11 from Homebrew. No exclusive CPU control or cross-platform performance comparison was established.

| Synthetic storage/parser experiment | Measured result |
|---|---:|
| Sample | 200 copies of one RPC shape, with generated signatures |
| Parser p50 / p95 | 0.246 / 0.664 ms, 200 samples |
| Commit batch p50 / p95 | 19.640 / 38.623 ms, 10 batches of 20 |
| Total insert commit time | 206.742 ms |
| Storage records per second | 967.39 for this one small run |
| Exact duplicate replays suppressed | 200/200 |
| Duplicate replay duration | 96.579 ms |
| Ending RSS | 168,919,040 bytes |

This experiment includes parsing and local PostgreSQL storage separately. It excludes RPC latency and alert dispatch, leaves 200 pending intents in a disposable schema, then drops that schema. It is not mainnet throughput or an optimization speedup. Raw conditions and results: [monitor-benchmark.json](monitor-benchmark.json).

| Public mainnet run | Five-minute bounded run | Three-minute bounded recovery run |
|---|---:|---:|
| Logged cycles | 10 | 6 |
| Newly inserted raw observations | 37 | 11 |
| Degraded cycles | 9, all catch-up-pending | 0 |
| Median cycle time | 576.5 ms | 295 ms |
| Maximum cycle time | 1,176 ms | 1,381 ms |
| First / ending RSS | 94,617,600 / 49,463,296 bytes | 118,915,072 / 44,302,336 bytes |
| Final journal | 42 observations | 53 observations |
| Final journal outcomes | 41 UNKNOWN, 1 FAILED | 52 UNKNOWN, 1 FAILED |

These were separate runs against one public sample wallet, with a restart between them. The five-minute run predates the freshness refinement; its final healthy label must be read with that limitation. The recovery run uses the corrected freshness behavior and larger polling pages. The final IDL restrictions were validated afterward against replay and the full suite. No RPC failures or unexpected exits were observed in these two logs; `failedPolls` in the first log includes catch-up-pending and is not a network-error count. No live trade alerts fired, and no real performance or profitability was measured. [Soak summary](soak-summary.json) and raw JSONL logs preserve those boundaries. CPU utilization, network latency distributions, long-run growth and seven-day uptime were not measured.

## 7. Release-candidate status

| Area | Status | Evidence boundary |
|---|---|---|
| Ingestion reliability | PARTIAL | Atomic finalized polling and failure tests pass; history and address scope remain bounded. |
| Transaction correctness | PARTIAL | One directional training case; eight successful cases still abstain. |
| Deduplication | PASS for tested scope | PostgreSQL fact/cursor conflicts, event IDs and synthetic replay verified. |
| Restart/recovery | PASS for tested boundaries | Actual ingestion kills and injected alert pre-ack interruption pass. |
| Sustained read-only operation | PARTIAL | Only short local mainnet runs. |
| Observability | PASS for local scope | Protected checkpoint/outcome/backlog status and stopped-worker degradation verified. |
| Safety | PASS for tested scope | Read-only RPC whitelist, monitor-only production gate, live flags false and duplicate paper protection. |
| Performance | PARTIAL | One small local synthetic storage run; no representative load study. |
| Test coverage | PARTIAL | 354 local tests pass; broader protocols, long outages and hosted CI remain unverified. |
| Documentation reproduction | PASS locally | Setup, validation, collection/evaluation, worker, backup/restore commands verified. |

## 8. Remaining backlog and known limitations

**P0 release gates:** establish an independent, representative labeled corpus and acceptable coverage; complete a sustained pilot; provision an always-on private host, appropriate RPC service, external HTTPS, backup retention and operational supervision. These are not completed by the local setup.

**P1 correctness/architecture:** track owned token accounts for incoming activity; expand protocol and Token-2022 semantics conservatively; implement a versioned replay/migration policy for immutable observations; establish retention without deleting replay identities; implement an external delivery provider before offering that channel. Existing global state and process-local quotas support a private single-operator/single-web-instance pilot, not multi-tenant service operation.

**P1 paper research:** generic portfolio setters can bypass the atomic fill workflow if called directly, and multi-query state reads can reject stale operations conservatively. Production monitoring disables that paper workflow; enabling it does not certify a complete concurrent portfolio service. Historical price, cost basis and risk coverage remain incomplete.

**P2 operations/performance:** profile the global ingestion capacity lock and count queries at realistic volume; improve quota sharing and audit/rotation tooling if deployment scope expands; add controlled CPU/network measurements and cross-platform CI evidence. The unavailable Helius streaming adapter remains separate from the working polling path.

The initial history window is explicit; pruned/unavailable history stops catch-up. CURRENT never means complete lifetime coverage. Scores and signals cannot establish profitability from unpriced observations. The 100,000-observation default journal cap, pending-intent cap and 100,000 durable-event cap require an operator plan before sustained load. External notifications are unsupported, and no transaction signing, broadcasting or real-money execution was introduced.

## 9. Next experiments, ranked

1. Build a reviewed holdout corpus with BUY/SELL/transfer/failed/ambiguous cases across several protocols and account lifecycle shapes; measure coverage as well as errors.
2. Run a seven-day private pilot with a provisioned provider, forced restarts/outages, rotated logs and explicit stale/backlog criteria.
3. Add ownership-based token-account monitoring and test incoming transfers absent from wallet account keys.
4. Design versioned historical replay and safe archival before raising storage capacity.
5. Profile representative multi-wallet bursts and database contention; change one measured bottleneck at a time.

The single highest-value next objective is the independent holdout corpus: the current live sample preserves data reliably but recognizes too little activity to justify a broadly useful monitoring claim.

## 10. Checkpoints and defensible project claim

- `f5b3e2e`: prior Session 1 evidence baseline.
- `8367e6e`: durable read-only monitoring, private staging controls, provenance fixes, mainnet regression and recovery evidence.
- Documentation checkpoint follows this engineering commit; obtain it with `git log -2 --oneline`. The isolated branch is packaged in a Git bundle; no baseline replacement or remote deployment was performed.

**Project claim:** Solana Sentinel is a read-only wallet monitoring and paper-research system with transactionally persisted PostgreSQL ingestion, restart and deduplication tests, and an explicitly limited real-mainnet interpretation corpus.
