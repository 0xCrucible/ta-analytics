# TA Metrics — Trading Fees to Treasury

Latest layout changes:
- TA Activity variable metrics are now exactly:
  - Trading Volume
  - Donations Made
  - Trading Fees to Treasury
- All three follow the same 24H / 7D / 30D selector.
- Current Treasury Balance is not shown as a TA Activity metric; it remains in the upper current-summary area.
- Holder metrics remain outside TA Activity.
- Total Contributions keeps the “View contribution records →” link.
- States Impacted remains in the summary row with its breakdown view.

Repo structure:

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
