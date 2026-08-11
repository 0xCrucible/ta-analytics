# TA Metrics — persistent trade activity

This build stops rescanning 30 days of chain history on every page load. TA swap activity is stored in Supabase once, then the dashboard reads rolling 24H / 7D / 30D totals from that database.

## What changed

- `api/activity.js` now reads stored swaps from Supabase.
- `api/backfill.js` performs the one-time 30-day historical backfill in safe chunks.
- `api/sync-activity.js` catches up new swaps and is scheduled by Vercel once per day.
- `lib/activity-indexer.js` contains the Uniswap v4 indexer.
- `supabase/schema.sql` creates the two required tables.
- The indexer corrects Uniswap v4 direction handling: the Swap event amounts are pool balance deltas, so a positive TA delta is a sell and a negative TA delta is a buy.

## 1. Create a Supabase project

Create a project at Supabase, then open **SQL Editor** and run the entire contents of:

`supabase/schema.sql`

## 2. Add Vercel environment variables

In Vercel > Project > Settings > Environment Variables add:

- `SUPABASE_URL` — your project URL, e.g. `https://xxxxx.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` — the server-only service-role/secret key
- `BACKFILL_SECRET` — any long random string you create
- `CRON_SECRET` — another long random string you create
- `ROBINHOOD_RPC_URL` — optional but strongly recommended. Use a production Robinhood Chain RPC such as your Alchemy endpoint. If omitted, the code falls back to Robinhood's public RPC.

Never put the Supabase service-role key into `app.js`, `index.html`, or any browser-visible code.

Redeploy after adding the variables.

## 3. Start the 30-day backfill

Open this URL in your browser, replacing the secret:

`https://YOUR-SITE.vercel.app/api/backfill?secret=YOUR_BACKFILL_SECRET`

The response will include `done: false` while there are more blocks to process. Refresh/call it again until it returns:

`"done": true`

Each successful call stores its results permanently, so you do not lose progress between calls.

If a chunk times out, retry with a smaller block count, for example:

`/api/backfill?secret=YOUR_BACKFILL_SECRET&blocks=250000`

## 4. Verify

After at least one backfill chunk, open:

`/api/activity`

You should see JSON for `24h`, `7d`, and `30d`, including:

- `buyVolume`
- `sellVolume`
- `uniqueWallets`
- `swapCount`

When `backfillComplete` becomes `true`, the rolling 30-day history is fully populated for the indexed Uniswap v4 TA pools.

## Going forward

Vercel calls `/api/sync-activity` once daily. The sync stores every new indexed swap since the last saved block, with a small overlap to avoid boundary misses. Because the database stores the raw swap rows, the 24H / 7D / 30D windows remain rolling even though collection itself can run less frequently.

The daily schedule is intentionally compatible with Vercel Hobby cron limits. If your Vercel plan permits more frequent cron jobs, you can change `vercel.json` to run hourly for fresher activity numbers.

## Accuracy note

This build indexes TA's Uniswap v4 markets discovered through DEX Screener. It is much more reliable than rescanning the chain on each page view, but it should not be described as every possible TA trade on every protocol unless additional venues are added to the indexer.

USD values for historical swaps are estimates because each backfill chunk values TA using the market price available when that chunk is indexed. For the rolling 24H split, Buy Volume and Sell Volume are scaled to DEX Screener's live total 24H TA volume while preserving the on-chain buy/sell ratio.

## Files

```text
api/
  dashboard.js
  activity.js
  backfill.js
  sync-activity.js
lib/
  activity-indexer.js
supabase/
  schema.sql
app.js
index.html
styles.css
vercel.json
package.json
README.md
```


## Pool metadata fix
This build fixes Uniswap v4 backfill failures such as `Pool metadata unavailable for 0x80526500…`. V4 pool IDs are bytes32 identifiers, not pool contract addresses. The indexer now derives TA's currency position from the DEX Screener pair currencies and uses Initialize-event discovery only as a fallback.

## Launch-aware backfill
The initial backfill now uses the earliest TA Uniswap v4 market `pairCreatedAt` timestamp returned by DEX Screener and starts exactly 24 hours before it. If an older deployment already saved a cursor far before launch, the next `/api/backfill` call automatically advances that cursor to the launch-aware start block. No Supabase reset is required.


- Improved Contributions by State card legibility with separated cards, stronger state labels, and clearer donation/total hierarchy.


- Longer-range Trading Volume no longer displays $0 when historical indexing is empty. It falls back to the live 24H DEX volume and labels it as partial until indexed history is available.


- 7D / 30D / 1Y Trading Volume charts now begin at the TA market launch date.
- Days before launch are not plotted.
- Elapsed days with unavailable historical volume remain blank instead of being shown as $0.
- The latest live rolling 24H DEX volume is plotted on the current date and marked with an asterisk until historical daily indexing is available.
