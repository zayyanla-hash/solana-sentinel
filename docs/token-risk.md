# Token risk

Deterministic assessor (`token-risk-v2`) producing:

- `riskScore` 0–100
- `riskTier`: `LOWER_RISK` | `ELEVATED_RISK` | `HIGH_RISK` | `INSUFFICIENT_DATA`
- `riskFlags[]`, `riskReasons[]`, `dataConfidence`

**Never emits “SAFE”.** Required on-chain fields (`tokenProgram`, `mintAuthority`, `freezeAuthority`) missing → `INSUFFICIENT_DATA` regardless of liquidity or score. Other missing fields stay `null` — never optimistic defaults.

## On-chain mapping (Helius DAS + Solana RPC)

Official DAS `getAsset` (`showFungible: true`):

- Mint/freeze: `token_info.mint_authority` / `token_info.freeze_authority` (not `authorities[].type`)
- Token-2022: `mint_extensions` (permanent_delegate, transfer_hook, transfer_fee_config, non_transferable, …). If the object is absent on Token-2022, fields stay **null**
- Classic TOKEN program: permanent delegate / transfer hook treated as false (not applicable)

Holders (optional; null on RPC failure):

- `getTokenLargestAccounts` (up to 20 accounts)
- `getTokenSupply` for denominator
- Reports top-5 and top-10 concentration when supply is known

Other factors: liquidity, exit liquidity, token age, metadata quality, estimated price impact. Incomplete DAS → reject path via `INSUFFICIENT_DATA`, not a fake-clean profile.
