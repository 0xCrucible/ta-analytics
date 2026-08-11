# TA Metrics — Unique Buyers update

This version replaces **New Token Holders** in TA Activity with **Unique Buyers**.

## Unique Buyers definition
A unique buyer is a distinct recipient wallet in a TA token transfer that originates from one of the currently tracked TA liquidity-pool addresses returned by DEX Screener. A wallet is counted once per selected rolling window, even if it buys multiple times.

The metric uses exact rolling windows:
- 24H = last 24 hours
- 7D = last 7 × 24 hours
- 30D = last 30 × 24 hours

## Caveat
This is an on-chain pool-transfer heuristic. Trades routed through contracts or aggregators that receive TA on behalf of an end user can cause the receiving contract to be counted instead of the final user wallet. The dashboard does not invent a value when the explorer or pool-address source is unavailable.

## Deploy
Keep the repo structure:

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
