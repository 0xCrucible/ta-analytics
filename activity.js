const { getMarket, getState, readSwapsSince, summarize, buildActivitySeries } = require('../lib/activity-indexer');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const [rows, state, market] = await Promise.all([
      readSwapsSince(365),
      getState(),
      getMarket().catch(() => null),
    ]);

    const makeRange = (days) => ({
      ...summarize(rows, days),
      series: buildActivitySeries(rows, days),
    });

    const ranges = {
      '24h': makeRange(1),
      '7d': makeRange(7),
      '30d': makeRange(30),
      '1y': makeRange(365),
    };

    // Keep the 24H headline total aligned to DEX Screener while preserving
    // the direction split derived from indexed on-chain swaps.
    if (market?.volume24h > 0) {
      const splitTotal = ranges['24h'].buyVolume + ranges['24h'].sellVolume;
      if (splitTotal > 0) {
        const scale = market.volume24h / splitTotal;
        ranges['24h'].buyVolume *= scale;
        ranges['24h'].sellVolume *= scale;
        ranges['24h'].volume = market.volume24h;
        ranges['24h'].series = ranges['24h'].series.map(point => ({
          ...point,
          buyVolume: point.buyVolume * scale,
          sellVolume: point.sellVolume * scale,
          volume: point.volume * scale,
        }));
      }
    }

    const backfillComplete = Boolean(state?.backfill_complete);
    const latestStored = rows.length ? rows[rows.length - 1].block_timestamp : null;
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({
      ok: true,
      ranges,
      backfillComplete,
      latestStored,
      note: backfillComplete
        ? 'Buy/sell direction comes from indexed Uniswap v4 TA swaps. USD values are estimates; 24H is anchored to DEX Screener total volume.'
        : 'Historical trade backfill is still running. Longer-range figures may be incomplete until it finishes.',
      walletNote: 'Distinct transaction-origin wallets with TA buy or sell activity during this rolling period.',
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('activity error', error);
    return res.status(200).json({
      ok: false,
      ranges: { '24h': {}, '7d': {}, '30d': {}, '1y': {} },
      error: String(error?.message || error),
      updatedAt: new Date().toISOString(),
    });
  }
};
