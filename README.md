# TA Metrics — Uniswap v4 Activity Fix

This version fixes the previously blank **Buy Volume**, **Sell Volume**, and **Unique Wallets** metrics.

## What changed

TA's main market is Uniswap v4. In v4, DEX Screener's `pairAddress` is a 32-byte **pool ID**, while all pools emit their swap events from one shared `PoolManager`. The previous backend treated the pool ID like a normal pool contract address, so it found no activity.

This build now:

- Detects TA's Uniswap v4 pool ID from DEX Screener.
- Reads the pool's `Initialize` event to determine whether TA is currency0 or currency1.
- Reads the pool's actual v4 `Swap` events from the official Robinhood Chain Uniswap v4 PoolManager.
- Classifies each swap as a TA buy or sell from the signed TA amount.
- Resolves each swap transaction's originating `from` wallet using Robinhood Chain JSON-RPC.
- Counts distinct transaction-origin wallets for **Unique Wallets**.
- Uses exact rolling 24H / 7D / 30D timestamps.
- Anchors 24H Buy + Sell Volume to DEX Screener's reported 24H volume.
- Estimates 7D / 30D USD volume using on-chain TA swap quantities at the current TA/USD price.

## Dashboard order

Top row:
1. Trading Volume
2. Donations Made
3. Trading Fees to Treasury

Bottom row:
1. Buy Volume
2. Sell Volume
3. Unique Wallets

## Deploy

Keep the repo root:

```text
api/
  dashboard.js
app.js
index.html
styles.css
vercel.json
package.json
README.md
```

For this fix the critical replacement is `api/dashboard.js`.
