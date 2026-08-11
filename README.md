# TA Metrics — Brand Refresh

This version updates the site to a lighter TA-inspired aesthetic and changes the information hierarchy so **Total Contributions** is the main hero number.

## Included
- Large hero total for **Total Contributions**
- Treasury verification card in the hero section
- CTA buttons:
  - Submit a Child's Account → `https://ta.fund/submit-account`
  - Trade $TA on FOMO → `https://fomo.family/r/parad0x1010`
- 24H / 7D / 30D period toggle
- Cards for:
  - Trading Volume
  - Donations Made
  - New Holder Wallets
  - Treasury Balance
  - Total Holders

## Data notes
- **24H trading volume** comes from public DEX Screener endpoints.
- **Treasury / Total Contributions / Accounts Funded** come from TA Fund's published pages.
- **Total holders** will display if the public explorer returns a holder count from one of the attempted token endpoints.
- **New Holder Wallets** is visually included, but many public explorers do not expose first-time-holder history directly. If the current source does not provide it, the site will show a note instead of inventing the number.

## Deploy
The repo root should look like this:

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

Then deploy to Vercel with the root directory set to `./` (or blank).

## Treasury inflow metric
The Trading Volume card now also displays **Added to Treasury** for the selected 24H / 7D / 30D period. It uses actual ERC-20 transfers into the published treasury address from the Robinhood Chain Blockscout address token-transfer endpoint rather than assuming a fee percentage.

Because token transfer USD valuation depends on the explorer response, the metric intentionally displays `—` if Blockscout cannot provide a usable USD value rather than fabricating an estimate.


## State Impact view
The header **States** button opens an interactive state impact view. The API now follows all pages of TA Fund's published contributions, deduplicates records by Contribution ID, and aggregates them by state. Each state shows the number of contributions, individual contribution amounts, and cumulative total.
