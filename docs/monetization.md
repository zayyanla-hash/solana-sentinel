# Monetization

**Status:** ARCHITECTURE IMPLEMENTED. Billing is not live. Prices are **not** hardcoded in gating logic.

Entitlements live in `@sat/entitlements`. Suggested list prices (docs only):

| Tier | Suggested | Capabilities |
|------|-----------|----------------|
| FREE | $0 | Delayed feed, limited wallet lookups, 3 backtests/day |
| PRO | $19–29/mo | Real-time alerts, Strategy Lab, advanced signals |
| ADVANCED | $59–99/mo | Clustering, API quota, deeper history |
| API | usage | Metered `/api/v1` + optional x402 |

## x402 V2

Isolated PoC at `/api/premium/:resource/:id`.

- Off unless `X402_ENABLED=true`
- Devnet only (`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`)
- Facilitator verification required — never invents payment success
- Mainnet payments throw

See https://docs.x402.org/getting-started/quickstart-for-sellers
