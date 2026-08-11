# TA Metrics — Treasury Flow Fix

This version fixes the **Added to Treasury** 24H / 7D / 30D metric.

## What changed

The previous version depended on one Blockscout endpoint and expected each transaction row to provide a USD exchange rate. That could leave the metric blank.

This version:
- checks **direct native transactions** into the treasury Safe;
- checks **internal native transactions** into the Safe;
- uses Blockscout API v2 first and falls back to its legacy account API;
- separately fetches the chain's current native-coin USD price when a transaction row has no historical exchange rate;
- returns useful diagnostic details in `/api/dashboard` under `sourceStatus`.

## Important valuation note

When Blockscout provides a per-transaction exchange rate, the dashboard uses it. When it does not, the dashboard values the received native coin at the **current native-coin USD price** and labels the card accordingly. This is an estimate of current USD value, not a historical USD-at-receipt valuation.

## Deploy

Replace these files in your repo:
- `api/dashboard.js`
- `README.md`

You may replace the full project if preferred.
