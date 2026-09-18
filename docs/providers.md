# Providers

| Provider | Current API | Status |
|----------|-------------|--------|
| Jupiter Swap API V2 | `GET https://api.jup.ag/swap/v2/order` | IMPLEMENTED quote/plan only. `/execute` forbidden |
| Jupiter Ultra | superseded by Swap V2 | NOT USED. Legacy class refuses calls |
| Jupiter Metis v1 `/quote` | deprecated | REMOVED silent fallback |
| Birdeye OHLCV | `/defi/v3/ohlcv` then legacy | IMPLEMENTED. Trending fails closed (no silent demo mix) |
| Helius DAS | `getAsset`, largest accounts | IMPLEMENTED |
| Helius enhanced-tx | `/v0/addresses/{addr}/transactions` | IMPLEMENTED SWAP→BUY/SELL; transfers remain transfers. Legacy API in maintenance; Parsed Events successor not required yet |
| Helius LaserStream | websocket | EXPERIMENTAL adapter + DEMO stream |
| OpenAI-compatible LLM | chat completions | OPTIONAL, advisory only |
| x402 facilitator | `https://x402.org/facilitator` | EXPERIMENTAL, flag-off |

Missing credentials → labeled DEMO adapters. Live provider errors do **not** return fake-clean market data.
