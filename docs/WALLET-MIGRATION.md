# Wallet migration intelligence

`@sat/wallet-migration` detects token migration signals from a wallet selling token A and then buying a different token B. It emits one aggregate A→B result across the observed wallets, rather than one result per wallet.

## Inputs and time bounds

Call `detectWalletMigrations` with `tradesByWallet`, optional wallet graph `clusters`, and an `asOf` timestamp. `windowHours` controls the causal lookback ending at `asOf`; `maxDelayHours` bounds the time from each sell to its buy. Both legs must be inside the lookback, and no future records are used. Same-transaction atomic SELL/BUY pairs are reserved before matching later buys to earlier sells. An atomic pair at the same timestamp is accepted when both records share a nonempty `sourceSignature` or the same exact signature. Side-specific normalized signatures can therefore match by their source transaction. Equal timestamps without shared transaction identity do not establish order. Runtime input is validated with Zod. Exact duplicate wallet/signature/mint/action records are counted once regardless of source-signature metadata; conflicting duplicate payloads fail closed. Overlapping supplied clusters also fail closed. Output ordering and IDs are stable for the same evidence.

## Wallet and cluster counts

Each distinct wallet contributes once to `uniqueWalletCount`, even if it repeats the same transition. `transitionCount` reports matched sell/buy pairs, with `repeatPenalty` increasing only for pairs beyond the distinct wallet count. `clusterAdjustedCount` adds one for each represented cluster and one for each unclustered migrating wallet. Other members of a supplied cluster do not dilute the count. `migrationVelocityWalletsPerHour` is distinct migrating wallets divided by the configured `windowHours` lookback. Cluster membership is graph evidence only and never establishes shared ownership. The module does not produce or fabricate a wallet credibility score.

## Valuation and evidence

`estimatedMigratedNotionalUsd` estimates matched capital by summing the lower of the SELL and BUY USD notionals for every matched transition. It is not a directional net flow. Both legs of every transition must have observed values for the estimate to be complete. If any leg is missing or invalid, the estimate is null; `valuationQuality` is `PARTIAL` when some usable leg values exist and `MISSING` when none do.

A positive `usdNotional` is used as the observed historical trade notional unless its attached `priceAsOf` is in the future. Otherwise value is derived from absolute quantity times a positive `priceUsd` only when `priceSource` is present and `priceAsOf` is no later than the trade timestamp and within `maxPriceAgeHours` (default 24 hours). Future, stale, or provenance-free prices are excluded. Evidence retains exact transaction signatures, source signatures when present, wallet, side, mint, timestamp, quantity, provider, and observed price source/time and cost-basis state when supplied. `firstTransitionAt` and `lastTransitionAt` use BUY timestamps, marking transition completion rather than its preceding SELL.

Transfers alone do not trigger migration results. The module describes observed trading sequence evidence; it does not infer wallet identity, intent, ownership, or guaranteed outcomes.
