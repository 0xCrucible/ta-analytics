const { backfillChunk } = require('../lib/activity-indexer');

function authorized(req) {
  const secret = process.env.BACKFILL_SECRET;
  if (!secret) return false;
  const bearer = String(req.headers.authorization || '') === `Bearer ${secret}`;
  const query = String(req.query?.secret || '') === secret;
  return bearer || query;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const chunkBlocks = Math.max(50000, Math.min(1500000, Number(req.query?.blocks) || 1000000));
    const result = await backfillChunk({ days: 30, chunkBlocks });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, ...result, next: result.done ? null : 'Call this endpoint again to process the next chunk.' });
  } catch (error) {
    console.error('backfill error', error);
    return res.status(500).json({ ok: false, error: String(error?.message || error) });
  }
};
