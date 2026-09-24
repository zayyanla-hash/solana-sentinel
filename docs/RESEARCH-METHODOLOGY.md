# Research Methodology — Independent Validation

How this repository validates strategy observations without fooling itself.
The enforcement point is `packages/validation-lab` (see
[VALIDATION-LAB.md](./VALIDATION-LAB.md)); this note states the principles
behind it.

## 1. Observational data only

Validation consumes externally supplied, timestamped equity and trade
observations. It never invents prices, fills, or trajectories. Any analysis
that would require unobserved data is omitted with a machine-readable reason
(`benchmarkOmittedReason`, `costOmittedReason`, `latencyOmittedReason`,
`walkForwardOmittedReason`, `bootstrapOmittedReason`) instead of being modeled
from nothing.

## 2. Causality before statistics

- Series must arrive in strictly increasing time order; the lab rejects
  out-of-order rows rather than re-sorting them into a convenient past.
- Duplicate timestamps and duplicate trade records are hard errors.
- Trades outside the equity observation window are rejected: no performance
  can be attributed to periods with no observations.
- Train / validation / final-OOS splits are index-contiguous partitions with
  no overlap. Model selection may use train + validation; the final OOS block
  is evaluated once, and walk-forward test windows always start exactly at
  their train boundary.

## 3. Separation of selection and evaluation

Tuning on the same data used for reporting is the most common source of
inflated results. The required discipline:

1. Fit and select on train.
2. Confirm on validation.
3. Report on the final OOS segment, once.
4. Treat chronological fold summaries over the fixed supplied NAV path
   (`walkForward`) and bootstrap summaries as robustness context, not as
   replacements for the held-out OOS number. `walkForward` performs no model
   retraining — each fold reports the observed NAV return for its test slice.

Past segments do not predict OOS — every `OK` result carries that disclaimer
in `warnings`.

## 4. Costs are part of the result

The supplied NAV path does not declare whether it already includes fees.
`costDragUsd` reports supplied per-trade `feeUsd`; scenario rows apply only
additional fee, slippage, or latency drag to the observed OOS return. They
must not be described as independently verified net returns. Trades between
segment boundary marks are counted once in the following segment. When no
OOS trades are supplied, cost and latency tables are omitted rather than
fabricated. Sensitivity rows that reverse or erase an edge must be reported
alongside the observed return.

## 5. Baselines, not vibes

A strategy return is uninterpretable without a baseline. Benchmark comparison
uses only supplied benchmark points that fall inside the OOS window — never
interpolated, backfilled, or aligned by assumption — and requires exact
benchmark observations at both OOS boundary timestamps. A late-starting or
early-ending benchmark ⇒ no comparison, with the reason recorded. Excess is
the full-OOS strategy return minus the boundary-to-boundary benchmark return.

## 6. Sample-size and annualization honesty

- Segments under 30 points report `null` for annualized Sharpe, Sortino, and
  volatility (small samples cannot support strong inference); Sortino uses
  downside deviation over all interval returns relative to zero, and the
  positive-interval fraction is reported as `positivePeriodRate` — never
  mislabeled as a trade win rate.
- Annualization uses a caller-supplied `periodsPerYear`; each segment's own
  median observation interval is checked. A materially different cadence
  (> 2× either direction) or irregular intervals within a segment suppress
  annualized Sharpe/Sortino/volatility (`null`) with a warning.
- Below `minTotalPoints` / `minOosPoints`, or with fewer than 2 points in any
  train/validation/OOS slice, the lab returns
  `INSUFFICIENT_HISTORY` with metrics hidden. Absence of evidence is reported
  as absence — never as a zero, a benchmark, or a projection.

## 7. Determinism and provenance

Same input envelope reproduces the identical
result, including bootstrap percentiles (seeded PRNG) and the default clock.
Every result embeds
`provenance`: engine version, resolved config, FNV-1a digest of the input
envelope, data-source label, and clock. The default clock is the last input
equity timestamp (fixed epoch for empty input) — never the wall clock, so an
omitted `clockIso` still replays deterministically. A validation claim that cannot be
replayed from its provenance is not a validation claim.
