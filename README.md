# Solana Sentinel

**Solana Agentic Trading Research Platform**

**PAPER ONLY. LIVE OFF. `canBroadcast=false`.**

Deterministic, agent-assisted Solana research and paper-trading terminal. Discovery, historical signals, Token-2022-aware token-risk v2, wallet credibility, smart-money signals, walk-forward backtests, policy and portfolio-risk gates, bounded LLM research, Jupiter Swap API V2 quote/route modeling (never `/execute`), simulated fills, versioned `/api/v1`, Postgres-ready persistence, and experiment analytics with provenance.

> Not investment advice. Not a fatwa authority. Risk tiers never use the label “SAFE”.
>
> No live trading. No wallet custody. No transaction broadcasting.

## Quick start

```bash
pnpm install
cp .env.example .env.local
pnpm --filter @sat/web run dev
```

Open http://127.0.0.1:4317. Default bind is loopback. Demo data is labeled in the banner.

```bash
pnpm exec vitest run
pnpm lint
pnpm --filter @sat/web run build
pnpm exec playwright test
```

## Operating modes

| Mode | Behavior |
|------|----------|
| DEMO | Labeled demo market data + mock research |
| PAPER | Quotes may hit Jupiter; fills are simulated only |
| READ_ONLY | Research without paper fills |
| LIVE | Remapped to PAPER. Broadcast is not implemented |
| PUBLIC_DEMO=true | Anonymous users cannot mutate. Operator POSTs need SAT_API_TOKEN |

`isLiveTradingAllowed()` always returns false.

## Environment

See `.env.example`. Missing credentials produce labeled DEMO/mock adapters. `DATABASE_URL` absent means `health.persistence = memory`.

## Safety

- No seed phrases, private keys, or custodial wallets
- No sendTransaction / sendRawTransaction
- No Jupiter /execute or /submit
- No leverage, margin, perps, options, or prediction markets
- LLM cannot approve trades or override engines

See SECURITY.md.

## Docs

- docs/architecture.md
- docs/API.md
- docs/wallet-intelligence.md
- docs/helius-migration.md
- docs/lot-accounting.md
- docs/backtesting.md
- docs/monetization.md
- docs/PRODUCT-STRATEGY.md
- docs/providers.md
- docs/limitations.md
- docs/V2-HANDOFF.md
- docs/V1.5-HANDOFF.md (historical)
- docs/AUDIT-GROK.md (historical)

## What not to claim

Do not describe this repository as profitable, production trading software, professionally audited, live trading, complete rug detection, complete Token-2022 coverage, or Shariah-certified.

## License

Private research prototype — use at your own risk.
