# API

Versioned JSON under `/api/v1`. Every response includes `requestId`, `version: "v1"`.

## IMPLEMENTED

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/health` | Distinguishes healthy / degraded / demo_fallback / unavailable |
| GET | `/api/v1/health` | Same, machine-friendly |
| GET | `/api/v1/token/:mint` | Asset + risk + score |
| GET | `/api/v1/token/:mint/risk` | Token-risk v2 |
| GET | `/api/v1/token/:mint/signals` | Smart-money signals |
| GET | `/api/v1/wallet/:address` | Credibility score |
| GET | `/api/v1/wallet/:address/score` | |
| GET | `/api/v1/wallets` | Demo wallet set |
| GET | `/api/v1/wallets/graph` | ADVANCED entitlement |
| GET | `/api/v1/signals` | |
| GET | `/api/v1/market/regime` | |
| GET | `/api/v1/opportunities` | |
| POST | `/api/v1/backtests` | PRO entitlement |
| POST | `/api/v1/alerts` | Create rule |
| GET | `/api/premium/:resource/:id` | x402 flag, 402 if unpaid |

Existing dashboard mutations remain `POST /api/state` (CSRF + PUBLIC_DEMO gates).

Rate limit: in-memory token bucket per forwarded IP. Replace before multi-instance production.

CLI: `pnpm --filter @sat/cli start -- health`
