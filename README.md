# TA Metrics — Dex/Contract CTA layout

Latest layout update:
- Token contract box sits next to **View on Dexscreener**.
- **Trade $TA on FOMO →** is now a smaller blue text link under the contract box.
- The contract remains copyable.
- The child-account CTA remains the primary button.

Deploy with the same Vercel structure:

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


## Latest change
- Added **New Token Holders** to the TA Activity metric grid.
- It follows the same rolling 24H / 7D / 30D selector.
- The backend does not fabricate holder growth. If the public explorer cannot provide historical holder data, the metric displays `—` with an availability note.
