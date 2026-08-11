# TA Metrics — resilient activity build

This build separates the expensive Uniswap v4 activity scan from the core dashboard.

## API routes
- `/api/dashboard` — total contributions, treasury, donations, states, holder count, 24H DEX volume and treasury-fee inflows.
- `/api/activity` — Buy Volume, Sell Volume, Unique Wallets, and reconstructed 7D/30D trading volume.

If `/api/activity` is slow or temporarily unavailable, the rest of the dashboard still renders normally.

## GitHub/Vercel structure
```text
api/
  dashboard.js
  activity.js
app.js
index.html
styles.css
vercel.json
package.json
README.md
```
