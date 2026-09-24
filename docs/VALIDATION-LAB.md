# Validation Lab — Operator Guide

Generate the compact machine-readable example with `pnpm exec tsx scripts/generate-validation-fixture.ts`. The result is written to `artifacts/validation/synthetic-flat.json` and is explicitly labeled `FIXTURE`.

Standalone deterministic validation for **externally supplied** timestamped
equity and trade observations. Package: `packages/validation-lab`
(`@sat/validation-lab`, engine `validation-lab-v1`).

## Non-negotiables

- **No invented prices or performance.** Every number derives from supplied
  observations. Anything that cannot be computed from the input is omitted
  with an explicit `*OmittedReason` — never synthesized or interpolated.
- **Strict causality.** Inputs must arrive in strictly increasing timestamp
  order; duplicate timestamps are rejected. Train / validation / final-OOS
  segments partition the series with no overlap, and every chronological fold-summary test
  window starts exactly at its train boundary (no retraining implied).
- **Deterministic replay.** Same input envelope + same `seed` ⇒ byte-identical
  result, with or without an explicit `clockIso` (the default clock is the
  last input equity timestamp, or a fixed epoch for empty input — never the
  wall clock). Bootstrap uses a seeded PRNG (`mulberry32`).
- **Fail-closed on thin data.** Below `minTotalPoints` total,
  `minOosPoints` OOS points, or fewer than 2 points in any of the
  train/validation/OOS slices (tiny split fractions included), the result is
  `INSUFFICIENT_HISTORY` with `metrics: null`. Segment boundaries are still reported so the shape stays
  machine-readable, but no performance is shown.

## Input

```ts
import { runValidation } from "../packages/validation-lab/src/index";

const result = runValidation({
  equity: [{ t: "2026-01-01T00:00:00.000Z", nav: 1000 }, /* … */],
  trades: [{ t: "…", side: "BUY", price: 100, qty: 1, feeUsd: 0.5 }], // optional
  benchmark: [{ t: "…", value: 500 }],                                // optional
  config: { seed: 7 },                                                // optional overrides
  dataSource: "csv-import-2026-09",                                   // provenance label
  clockIso: "2026-09-24T00:00:00.000Z",                               // pin for replay
});
```

Validation errors (all `ValidationError` with a machine-readable `code`):

| Code | Meaning |
|------|---------|
| `BAD_TIMESTAMP` | Empty or unparseable timestamp |
| `NON_MONOTONIC_TIMESTAMPS` | Input out of time order — rejected, never re-sorted silently |
| `DUPLICATE_TIMESTAMP` / `DUPLICATE_TRADE_TIMESTAMP` / `DUPLICATE_TRADE` | Exact duplicates rejected |
| `TRADE_OUT_OF_RANGE` | Trade outside the equity observation window |
| `INVALID_EQUITY` / `INVALID_TRADE` / `INVALID_BENCHMARK` | Non-finite or non-positive values, bad side |
| `INVALID_SPLIT` / `INVALID_CONFIG` | Bad split fractions or config ranges |

Malformed trades/benchmarks are rejected **before** the sufficiency gate, so
short series never silently swallow bad rows.

## Output (`ValidationResult`, JSON-safe)

- `status`: `"OK"` or `"INSUFFICIENT_HISTORY"`.
- `segments`: `{ train, validation, oos }` slices with index ranges,
  boundary timestamps, point counts, and spans.
- `metrics`: per-segment `{ totalReturnPct, maxDrawdownPct, sharpe, sortino,
  volatilityPctAnn, positivePeriodRate, tradeCount, costDragUsd, warnings }`, or `null`
  under `INSUFFICIENT_HISTORY`. `positivePeriodRate` is the fraction of
  positive interval NAV returns — not a trade win rate (no per-trade PnL is
  supplied, so no trade hit rate is reported).
- `benchmark`: strategy-vs-benchmark OOS comparison computed **only** from
  supplied benchmark points inside the OOS window with exact observations at
  both OOS boundary timestamps; otherwise `null` + reason (late-starting or
  early-ending benchmarks are omitted, never interpolated).
- `costSensitivity`: fee-multiplier / slippage rows as extra drag on the
  observed OOS endpoint (base fees and notional come from supplied OOS
  trades). `oosReturnAfterExtraCostsPct` is the observed return after this
  incremental drag; the input NAV's fee convention is unknown, so this is
  not a verified net return. Omitted when no OOS trades exist.
- `latencySensitivity`: deterministic adverse-move penalty per `latencyStepsMs`
  on supplied OOS notional. The `+0ms` row carries zero drag. Omitted when no
  OOS trades exist.
- `walkForward`: chronological fold summary over the fixed supplied NAV path
  (`testStartIndex == trainEndIndex`), omitted unless ≥ 2 honest folds exist.
  No model is retrained — each fold reports the observed NAV return for its
  test slice. `folds < 2` disables it explicitly.
- `bootstrap`: seeded resample of OOS simple returns (p5/p50/p95 + mean),
  omitted with fewer than 10 OOS returns. `samples = 0` disables it explicitly.
- `warnings`: always includes the observational-replay disclaimer on `OK`;
  segment metrics add sample-size (`< 30` points, `< 10` trades), Sharpe/
  Sortino data-quality, and annualization-mismatch notes. Annualized Sharpe,
  Sortino, and volatility are suppressed (`null`) on annualization mismatch
  or on segments with fewer than 30 NAV points — never reported with a mere
  warning.
- `provenance`: `{ engineVersion, seed, config, inputDigest (FNV-1a),
  dataSource, clockIso }`. When `clockIso` is omitted, the default is the
  last input equity timestamp (fixed epoch for empty input) — never the wall
  clock, so replay stays deterministic.

## Config defaults

`split 0.6/0.2/0.2`, `minTotalPoints 30`, `minOosPoints 10`,
`periodsPerYear 252`, `seed 7`, `walkForwardFolds 3`,
`bootstrapSamples 1000` (cap 5000), cost scenarios
`base / fees-x2 / slip-50bps`, latency steps `[0, 100, 500]ms` at
`5 bps/100ms`. Override via `config`; splits must sum to 1.

## Annualization honesty

`periodsPerYear` is caller-supplied context, not inferred. When a segment's
median observation interval implies a yearly cadence more than 2× away from
`periodsPerYear`, annualized Sharpe, Sortino, and volatility are suppressed
(`null`) with a warning attached. Irregular intervals within a segment also
suppress them. Segments with
fewer than 30 NAV points likewise report `null` for those annualized risk
ratios. Sortino uses downside deviation over all interval returns relative
to zero (`sqrt(mean(min(r,0)^2))`); `positivePeriodRate` is the fraction of
positive intervals, not a trade win rate.

## Tests

`tests/validation-lab.test.ts` (25 tests): leakage/ordering, duplicate and
bad timestamps, out-of-range trades, fee/slippage math, latency rows,
benchmark baselines and boundary omissions, thin-split `INSUFFICIENT_HISTORY`,
`positivePeriodRate` naming, Sortino downside-deviation math,
annualization/small-sample suppression, deterministic clock default,
chronological fold-summary checks, deterministic replay, seed sensitivity,
`INSUFFICIENT_HISTORY` shape.
