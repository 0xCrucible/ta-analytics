# TA Metrics — Neutral Dashboard Refresh

This version makes the site more matter-of-fact and less stylized while keeping Total Contributions prominent.

## Design changes
- Removed decorative circles, stars, serif display typography, gradients, rounded luxury-card styling, and promotional headline copy.
- Uses a restrained neutral background, flat white data surfaces, thin borders, and straightforward sans-serif typography.
- Keeps **Total Contributions** as the first and largest number.
- Moves **State Impact** from the header into the analytics grid as a full peer metric tile.
- State Impact displays the number of states reached and opens the existing detailed state breakdown.

## Links
- Submit a Child's Account: https://ta.fund/submit-account
- Trade $TA on FOMO: https://fomo.family/r/parad0x1010

## Deployment structure
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


## State view update
Each state card now shows only the number of donations and the total donated to that state. Individual donation amounts and dates have been removed from the UI.


## Current analytics layout
The 24H / 7D / 30D selector now controls three variable metrics: Trading Volume, Donations Made, and Added to Treasury. Treasury Balance remains a current (NOW) value. Holder metrics are not shown in the TA Activity analytics grid.
