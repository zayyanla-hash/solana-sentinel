# Product strategy — Sentinel

Not investment advice. No TAM figures. No performance claims.

## 1. Wedge

Explainable Solana intelligence: **which assets are getting interesting, which wallets are involved, how credible those wallets are, what the hidden risks are, and whether a similar setup historically survived costs.**

## 2. Target user

Active Solana traders, funds, and AI agents who already pay for terminal data (Birdeye, Cielo, Arkham-like views) but need **provenance, risk gates, and paper-testable rules** rather than another bot.

## 3. Why they would pay

Alerts + wallet credibility + token-risk that does not hallucinate “SAFE”. Agents can query `/api/v1` instead of scraping a UI.

## 4. Strongest features (now)

Deterministic policy/risk, token-risk v2, paper execution with costs, wallet credibility engine, walk-forward backtests, versioned API, fail-closed Jupiter quotes.

## 5. Competitor overlap

Birdeye (market data), Cielo/Arkham (wallet labeling), Jupiter (execution), generic signal Discords. Overlap is data; gap is **explainable gates + paper validation**.

## 6. Differentiation

LLMs cannot override engines. DEMO vs live is labeled. Clusters never claim identity. Scores ≠ expected profit.

## 7. Monetization options

Entitlements FREE / PRO / ADVANCED / API. Optional x402 micropayments for agents. Traditional API keys later.

## 8. Cost drivers

Birdeye + Helius + (optional) Jupiter key + LLM. Cache OHLCV. Do not call LLMs for math. Streaming only when keyed.

## 9. Entitlement split

See `docs/monetization.md`. FREE delayed feed; PRO alerts + lab; ADVANCED clustering + API quota.

## 10. API / x402

`/api/v1` is the agent surface. x402 is a flag-off PoC on premium routes.

## 11. PMF metrics

Weekly retained wallets analyzed, alerts created, backtests finished, paid conversions, API calls per subscriber, gross margin after provider spend.

## 12. Do not build yet

Multi-chain, perps, options, autonomous mainnet trading, custodial wallets, social feed, token launcher, indicator soup.
