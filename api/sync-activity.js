const { backfillChunk, getState, syncForward } = require('../lib/activity-indexer');

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return String(req.headers.authorization || '') === `Bearer ${secret}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const state = await getState();
    let backfill = null;
    if (!state?.backfill_complete) {
      backfill = await backfillChunk({ days: 30, chunkBlocks: 1000000 });
    }
    const forward = await syncForward({ overlapBlocks: 300, maxBlocks: 1500000 });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, backfill, forward, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('sync activity error', error);
    return res.status(500).json({ ok: false, error: String(error?.message || error) });
  }
};
