# Lot accounting

**Method:** FIFO on quantity (not USD) for matching BUY lots to SELL lots.

- Transfers and airdrops never open or close trading lots.
- A SELL with no prior BUY leaves no closed lot (unknown cost basis) — we do **not** invent P&L.
- `priced` is true only when **both** entry and exit `priceUsd` are present and > 0.
- Otherwise `costBasis` is `UNPRICED` or `PARTIAL`.
- `realizedPnlUsd` is null unless at least one closed lot is fully priced.

Current token price is never substituted for historical execution price (prices stay null unless a historical quote is supplied on the trade).
