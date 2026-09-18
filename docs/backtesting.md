# Backtesting

**Status:** IMPLEMENTED. Results are labeled `DEMO` / `BACKTEST` / `PAPER`. Not live profitability.

## Engine (`backtest-v1`)

- Signals at bar `i` use only closed bars `0..i`
- Fills at bar `i+1` **open** (no close-to-close lookahead)
- Costs: spread + slippage + impact from notional/liquidity + network fee
- Walk-forward: 60% train (no entries) / 20% validation / 20% out-of-sample
- Metrics hidden when trades &lt; 10 or equity points &lt; 30
- Random-entry control is seeded and labeled

## Strategy Lab

User-configurable floors (liquidity, age, wallet credibility, confirming wallets, momentum, volume, token-risk, volatility, sizing, stops, max hold, cooldown, exposure).

Run via UI tab, `POST /api/state` `{action:"backtest"}`, `POST /api/v1/backtests`, or `sentinel backtest`.
