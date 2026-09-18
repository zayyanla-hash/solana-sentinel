# Wallet intelligence

**Status:** IMPLEMENTED (DEMO fixtures + deterministic engine). Live chain history is PLANNED pending Helius wallet APIs.

## What it computes

For each observed wallet:

- Trading performance: realized P&L, win/loss rate, expectancy, profit factor, median return, drawdown, consistency
- Behavior: holding time, turnover, frequency, typical size, token-age and liquidity at entry
- Risk: illiquid entries, concentration, transfer/airdrop mix, observed age
- `WalletCredibilityScore`: `score`, `confidence`, `sampleSize`, `reasonCodes`, evidence, `dataFreshness`

## What it does **not** do

- Rank purely by raw P&L
- Count transfers or airdrops as buys
- Call any wallet guaranteed profitable (`neverGuaranteed: true`)
- Claim identity or ownership of clusters

Corrections: small sample, moonshot concentration, tiny notionals, wash/hyperactivity, creator/dev, illiquid entries.

Config version: `wallet-intel-v1`.
