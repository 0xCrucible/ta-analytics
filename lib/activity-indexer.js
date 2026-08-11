const TOKEN = '0x9ca1cc0c90d97b4f36c5e2232d4fbd705a73c65d';
const EXPLORER = 'https://robinhoodchain.blockscout.com';
const DEFAULT_RPC = 'https://rpc.mainnet.chain.robinhood.com/';
const V4_POOL_MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
const V4_SWAP_TOPIC = '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f';
const V4_INITIALIZE_TOPIC = '0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438';
const DAY_MS = 24 * 60 * 60 * 1000;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value.replace(/\/$/, '');
}

function supabaseHeaders(extra = {}) {
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function supabaseBase() {
  return `${requireEnv('SUPABASE_URL')}/rest/v1`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url, options = {}, timeoutMs = 10000) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${url} returned ${response.status}${body ? `: ${body.slice(0, 240)}` : ''}`);
  }
  return response.json();
}

async function rpc(payload, timeoutMs = 12000) {
  const url = process.env.ROBINHOOD_RPC_URL || DEFAULT_RPC;
  return getJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  }, timeoutMs);
}

function parseBlockNumber(value) {
  if (value == null) return null;
  const text = String(value);
  const number = text.startsWith('0x') ? parseInt(text, 16) : Number(text);
  return Number.isFinite(number) ? number : null;
}

function parseTimestamp(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value > 1e12 ? value : value * 1000;
  const text = String(value);
  if (/^0x[0-9a-f]+$/i.test(text)) return parseInt(text, 16) * 1000;
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    return n > 1e12 ? n : n * 1000;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

async function getLatestBlock() {
  const json = await rpc({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] });
  const block = parseBlockNumber(json?.result);
  if (block == null) throw new Error('Could not resolve latest block');
  return block;
}

async function getBlockAtTimestamp(ms) {
  const url = new URL(`${EXPLORER}/api`);
  url.searchParams.set('module', 'block');
  url.searchParams.set('action', 'getblocknobytime');
  url.searchParams.set('timestamp', String(Math.floor(ms / 1000)));
  url.searchParams.set('closest', 'before');
  const json = await getJson(url.toString(), { headers: { accept: 'application/json' } }, 10000);
  const block = parseBlockNumber(json?.result?.blockNumber ?? json?.result);
  if (block == null) throw new Error('Could not resolve block for timestamp');
  return block;
}

async function getMarket() {
  const urls = [
    `https://api.dexscreener.com/tokens/v1/robinhood/${TOKEN}`,
    `https://api.dexscreener.com/latest/dex/search?q=${TOKEN}`,
  ];
  let lastError;
  for (const url of urls) {
    try {
      const json = await getJson(url, { headers: { accept: 'application/json' } }, 8000);
      const all = Array.isArray(json) ? json : (Array.isArray(json?.pairs) ? json.pairs : []);
      const pairs = all.filter((p) => {
        const base = String(p?.baseToken?.address || '').toLowerCase();
        const quote = String(p?.quoteToken?.address || '').toLowerCase();
        return base === TOKEN || quote === TOKEN;
      });
      if (!pairs.length) throw new Error('No TA markets returned by DEX Screener');
      const ranked = [...pairs].sort((a, b) => (Number(b?.liquidity?.usd) || 0) - (Number(a?.liquidity?.usd) || 0));
      const taAsBase = ranked.find((p) => String(p?.baseToken?.address || '').toLowerCase() === TOKEN);
      const taAsQuote = ranked.find((p) => String(p?.quoteToken?.address || '').toLowerCase() === TOKEN);
      const price = Number(taAsBase?.priceUsd ?? taAsQuote?.priceUsd);
      const v4Pools = [];
      const seenPoolIds = new Set();
      for (const pair of pairs) {
        const poolId = String(pair?.pairAddress || '').toLowerCase();
        if (!/^0x[0-9a-f]{64}$/.test(poolId) || seenPoolIds.has(poolId)) continue;
        const base = String(pair?.baseToken?.address || '').toLowerCase();
        const quote = String(pair?.quoteToken?.address || '').toLowerCase();
        const other = base === TOKEN ? quote : (quote === TOKEN ? base : '');
        let tokenIndex = null;
        if (/^0x[0-9a-f]{40}$/.test(other)) {
          // Uniswap v4 orders PoolKey currencies by address, independent of
          // DEX Screener's base/quote presentation. Derive TA's amount0/amount1
          // position directly from the two currency addresses, so we do not
          // need to rediscover the PoolKey from an Initialize log.
          tokenIndex = BigInt(TOKEN) < BigInt(other) ? 0 : 1;
        }
        v4Pools.push({ poolId, otherCurrency: other || null, tokenIndex });
        seenPoolIds.add(poolId);
      }
      return {
        pools: v4Pools,
        poolIds: v4Pools.map((p) => p.poolId),
        tokenPriceUsd: Number.isFinite(price) && price > 0 ? price : null,
        volume24h: pairs.reduce((sum, p) => sum + (Number(p?.volume?.h24) || 0), 0),
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Market data unavailable');
}

async function getTokenDecimals() {
  try {
    const json = await getJson(`${EXPLORER}/api/v2/tokens/${TOKEN}`, { headers: { accept: 'application/json' } }, 8000);
    const decimals = Number(json?.decimals);
    return Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? decimals : 18;
  } catch {
    return 18;
  }
}

async function explorerLogs({ fromBlock, toBlock, topic0, topic1 }) {
  const url = new URL(`${EXPLORER}/api`);
  url.searchParams.set('module', 'logs');
  url.searchParams.set('action', 'getLogs');
  url.searchParams.set('fromBlock', String(fromBlock));
  url.searchParams.set('toBlock', String(toBlock));
  url.searchParams.set('address', V4_POOL_MANAGER);
  url.searchParams.set('topic0', topic0);
  if (topic1) {
    url.searchParams.set('topic1', topic1);
    url.searchParams.set('topic0_1_opr', 'and');
  }
  const json = await getJson(url.toString(), { headers: { accept: 'application/json' } }, 10000);
  if (Array.isArray(json?.result)) return json.result;
  const message = String(json?.message || json?.result || 'Log query failed');
  if (/no records/i.test(message)) return [];
  throw new Error(message);
}

async function logsComplete(params, depth = 0) {
  if (params.fromBlock > params.toBlock) return [];
  try {
    const rows = await explorerLogs(params);
    if (rows.length < 950 || params.fromBlock === params.toBlock || depth >= 16) return rows;
  } catch (error) {
    if (params.fromBlock === params.toBlock || depth >= 16) throw error;
  }
  const mid = Math.floor((params.fromBlock + params.toBlock) / 2);
  const left = await logsComplete({ ...params, toBlock: mid }, depth + 1);
  const right = await logsComplete({ ...params, fromBlock: mid + 1 }, depth + 1);
  return [...left, ...right];
}

function topicAddress(topic) {
  const hex = String(topic || '').replace(/^0x/, '');
  return hex.length >= 40 ? `0x${hex.slice(-40)}`.toLowerCase() : null;
}

function signedWord(word) {
  let n = BigInt(`0x${word}`);
  if (n & (1n << 255n)) n -= 1n << 256n;
  return n;
}

function decodeSwap(data) {
  const hex = String(data || '').replace(/^0x/, '');
  if (hex.length < 128) return null;
  try {
    return { amount0: signedWord(hex.slice(0, 64)), amount1: signedWord(hex.slice(64, 128)) };
  } catch {
    return null;
  }
}

async function getPoolMeta(poolId, latestBlock) {
  let rows = [];
  try {
    rows = await logsComplete({ fromBlock: 0, toBlock: latestBlock, topic0: V4_INITIALIZE_TOPIC, topic1: poolId });
  } catch {}
  let row = rows[0];

  // Some Blockscout deployments are unreliable when filtering a bytes32
  // indexed pool ID as topic1. TA is a young token, so fall back to scanning
  // recent Initialize events and match the pool ID locally.
  if (!row) {
    const recentStart = await getBlockAtTimestamp(Date.now() - 45 * DAY_MS).catch(() => Math.max(0, latestBlock - 5000000));
    const recent = await logsComplete({ fromBlock: recentStart, toBlock: latestBlock, topic0: V4_INITIALIZE_TOPIC });
    row = recent.find((item) => String(item?.topics?.[1] || '').toLowerCase() === poolId.toLowerCase());
  }

  const topics = row?.topics || [];
  if (!row || topics.length < 4) throw new Error(`Pool metadata unavailable for ${poolId.slice(0, 10)}…`);
  const currency0 = topicAddress(topics[2]);
  const currency1 = topicAddress(topics[3]);
  const tokenIndex = currency0 === TOKEN ? 0 : (currency1 === TOKEN ? 1 : null);
  if (tokenIndex == null) throw new Error(`TA not found in pool ${poolId.slice(0, 10)}…`);
  return { poolId, currency0, currency1, tokenIndex, currencySource: 'initialize-event' };
}

function logBlock(log) {
  return parseBlockNumber(log?.blockNumber ?? log?.block_number);
}
function logHash(log) {
  return String(log?.transactionHash ?? log?.transaction_hash ?? '').toLowerCase();
}
function logIndex(log) {
  return parseBlockNumber(log?.logIndex ?? log?.log_index ?? log?.index) ?? 0;
}

async function getBlockTimes(blockNumbers) {
  const unique = [...new Set(blockNumbers.filter((x) => Number.isInteger(x)))];
  const out = new Map();
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const payload = chunk.map((block, index) => ({
      jsonrpc: '2.0', id: index + 1, method: 'eth_getBlockByNumber', params: [`0x${block.toString(16)}`, false],
    }));
    const json = await rpc(payload, 12000);
    if (!Array.isArray(json)) throw new Error('RPC block batch unavailable');
    for (const item of json) {
      const block = parseBlockNumber(item?.result?.number);
      const timestamp = parseTimestamp(item?.result?.timestamp);
      if (block != null && timestamp != null) out.set(block, timestamp);
    }
  }
  return out;
}

async function getTxOrigins(hashes) {
  const unique = [...new Set(hashes.filter(Boolean))];
  const out = new Map();
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const payload = chunk.map((hash, index) => ({
      jsonrpc: '2.0', id: index + 1, method: 'eth_getTransactionByHash', params: [hash],
    }));
    const json = await rpc(payload, 12000);
    if (!Array.isArray(json)) throw new Error('RPC transaction batch unavailable');
    for (const item of json) {
      const hash = String(item?.result?.hash || '').toLowerCase();
      const from = String(item?.result?.from || '').toLowerCase();
      if (hash && from) out.set(hash, from);
    }
  }
  return out;
}

async function getState() {
  const url = `${supabaseBase()}/ta_indexer_state?id=eq.v4_main&select=*`;
  const rows = await getJson(url, { headers: supabaseHeaders() }, 8000);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function upsertState(patch) {
  const body = [{ id: 'v4_main', ...patch, updated_at: new Date().toISOString() }];
  const url = `${supabaseBase()}/ta_indexer_state?on_conflict=id`;
  await getJson(url, {
    method: 'POST',
    headers: supabaseHeaders({ Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify(body),
  }, 8000);
}

async function upsertSwaps(rows) {
  if (!rows.length) return 0;
  let written = 0;
  for (let i = 0; i < rows.length; i += 250) {
    const chunk = rows.slice(i, i + 250);
    const url = `${supabaseBase()}/ta_swaps?on_conflict=tx_hash,log_index`;
    await getJson(url, {
      method: 'POST',
      headers: supabaseHeaders({ Prefer: 'resolution=merge-duplicates,return=representation' }),
      body: JSON.stringify(chunk),
    }, 12000);
    written += chunk.length;
  }
  return written;
}

async function processRange(fromBlock, toBlock) {
  if (fromBlock > toBlock) return { fromBlock, toBlock, swaps: 0, rows: 0, pools: 0 };
  const [market, decimals] = await Promise.all([getMarket(), getTokenDecimals()]);
  if (!market.poolIds.length) throw new Error('DEX Screener did not return a Uniswap v4 TA pool ID');

  // Prefer currency ordering derived from DEX Screener's TA pair currencies.
  // A v4 pool ID is bytes32, not a contract address, and querying it as a
  // standalone pool is invalid. Only fall back to Initialize-event discovery
  // if DEX Screener did not provide a usable counter-currency address.
  const metas = [];
  for (const pool of (market.pools || [])) {
    if (pool.tokenIndex === 0 || pool.tokenIndex === 1) {
      metas.push({ poolId: pool.poolId, tokenIndex: pool.tokenIndex, currencySource: 'dexscreener' });
    } else {
      metas.push(await getPoolMeta(pool.poolId, toBlock));
    }
  }
  if (!metas.length) {
    for (const poolId of market.poolIds) metas.push(await getPoolMeta(poolId, toBlock));
  }
  const logGroups = [];
  for (const meta of metas) {
    logGroups.push(await logsComplete({ fromBlock, toBlock, topic0: V4_SWAP_TOPIC, topic1: meta.poolId }));
  }

  const raw = [];
  metas.forEach((meta, groupIndex) => {
    for (const log of logGroups[groupIndex]) {
      const decoded = decodeSwap(log?.data);
      const block = logBlock(log);
      const txHash = logHash(log);
      if (!decoded || block == null || !txHash) continue;
      const taRaw = meta.tokenIndex === 0 ? decoded.amount0 : decoded.amount1;
      if (taRaw === 0n) continue;
      const absoluteRaw = taRaw < 0n ? -taRaw : taRaw;
      const taAmount = Number(absoluteRaw) / (10 ** decimals);
      if (!Number.isFinite(taAmount) || taAmount <= 0) continue;
      // IPoolManager.Swap amount0/amount1 are deltas of the POOL balance.
      // Positive TA delta => pool received TA => trader SOLD TA.
      // Negative TA delta => pool sent TA => trader BOUGHT TA.
      const side = taRaw > 0n ? 'sell' : 'buy';
      const timestampFromLog = parseTimestamp(log?.timeStamp ?? log?.timestamp);
      raw.push({
        txHash,
        logIndex: logIndex(log),
        block,
        poolId: meta.poolId,
        side,
        taAmount,
        timestampFromLog,
      });
    }
  });

  if (!raw.length) return { fromBlock, toBlock, swaps: 0, rows: 0, pools: metas.length };

  const missingTimeBlocks = raw.filter((row) => row.timestampFromLog == null).map((row) => row.block);
  const [blockTimes, origins] = await Promise.all([
    missingTimeBlocks.length ? getBlockTimes(missingTimeBlocks) : Promise.resolve(new Map()),
    getTxOrigins(raw.map((row) => row.txHash)),
  ]);

  const rows = raw.map((row) => {
    const timestamp = row.timestampFromLog ?? blockTimes.get(row.block) ?? null;
    if (timestamp == null) return null;
    const priceUsd = market.tokenPriceUsd;
    return {
      tx_hash: row.txHash,
      log_index: row.logIndex,
      pool_id: row.poolId,
      block_number: row.block,
      block_timestamp: new Date(timestamp).toISOString(),
      wallet: origins.get(row.txHash) || null,
      side: row.side,
      ta_amount: row.taAmount,
      usd_volume_estimate: priceUsd == null ? null : row.taAmount * priceUsd,
      ta_price_usd_used: priceUsd,
      indexed_at: new Date().toISOString(),
    };
  }).filter(Boolean);

  const written = await upsertSwaps(rows);
  return { fromBlock, toBlock, swaps: raw.length, rows: written, pools: metas.length };
}

async function initializeBackfill(days = 30) {
  const state = await getState();
  const [desiredStartBlock, latestBlock] = await Promise.all([
    getBlockAtTimestamp(Date.now() - days * DAY_MS),
    getLatestBlock(),
  ]);

  // If an older build already completed a shorter backfill (for example 30D),
  // widen the saved backfill window to the requested history. Upserts make
  // rescanning the overlapping recent period safe.
  const currentStart = state?.backfill_start_block == null ? null : Number(state.backfill_start_block);
  const needsWiderHistory = currentStart == null || currentStart > desiredStartBlock;
  if (!needsWiderHistory && state?.backfill_complete) return state;
  if (!needsWiderHistory && state?.backfill_cursor_block != null && state?.backfill_target_block != null) return state;

  await upsertState({
    backfill_start_block: desiredStartBlock,
    backfill_cursor_block: desiredStartBlock,
    backfill_target_block: latestBlock,
    backfill_complete: false,
    last_synced_block: state?.last_synced_block ?? latestBlock,
  });
  return getState();
}

async function backfillChunk({ days = 30, chunkBlocks = 1000000 } = {}) {
  let state = await initializeBackfill(days);
  if (state?.backfill_complete) return { done: true, state };
  const cursor = Number(state.backfill_cursor_block);
  const target = Number(state.backfill_target_block);
  const toBlock = Math.min(target, cursor + chunkBlocks - 1);
  const result = await processRange(cursor, toBlock);
  const next = toBlock + 1;
  const done = next > target;
  await upsertState({
    backfill_cursor_block: done ? target : next,
    backfill_complete: done,
  });
  state = await getState();
  return { done, result, state };
}

async function syncForward({ overlapBlocks = 200, maxBlocks = 1500000 } = {}) {
  const latestBlock = await getLatestBlock();
  let state = await getState();
  if (!state) {
    await initializeBackfill(30);
    state = await getState();
  }
  const last = Number(state?.last_synced_block ?? latestBlock);
  const fromBlock = Math.max(0, Math.min(last + 1, latestBlock) - overlapBlocks);
  const toBlock = Math.min(latestBlock, fromBlock + maxBlocks - 1);
  const result = await processRange(fromBlock, toBlock);
  await upsertState({ last_synced_block: toBlock });
  return { caughtUp: toBlock >= latestBlock, latestBlock, result, state: await getState() };
}

async function readSwapsSince(days = 365) {
  const since = new Date(Date.now() - days * DAY_MS).toISOString();
  const rows = [];
  let offset = 0;
  const pageSize = 1000;
  while (offset < 100000) {
    const url = new URL(`${supabaseBase()}/ta_swaps`);
    url.searchParams.set('block_timestamp', `gte.${since}`);
    url.searchParams.set('select', 'tx_hash,log_index,pool_id,block_timestamp,wallet,side,ta_amount,usd_volume_estimate');
    url.searchParams.set('order', 'block_timestamp.asc');
    const response = await fetchWithTimeout(url.toString(), {
      headers: supabaseHeaders({ Range: `${offset}-${offset + pageSize - 1}` }),
    }, 10000);
    if (!response.ok) throw new Error(`Supabase activity query returned ${response.status}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

function summarize(rows, days) {
  const since = Date.now() - days * DAY_MS;
  const filtered = rows.filter((row) => Date.parse(row.block_timestamp) >= since);
  const buys = filtered.filter((row) => row.side === 'buy');
  const sells = filtered.filter((row) => row.side === 'sell');
  const sum = (items) => items.reduce((total, row) => total + (Number(row.usd_volume_estimate) || 0), 0);
  const wallets = new Set(filtered.map((row) => String(row.wallet || '').toLowerCase()).filter(Boolean));
  const buyVolume = sum(buys);
  const sellVolume = sum(sells);
  return {
    buyVolume,
    sellVolume,
    volume: buyVolume + sellVolume,
    uniqueWallets: wallets.size,
    swapCount: filtered.length,
    buyCount: buys.length,
    sellCount: sells.length,
  };
}

function buildActivitySeries(rows, days) {
  const cutoff = Date.now() - days * DAY_MS;
  const filtered = rows.filter((row) => Date.parse(row.block_timestamp) >= cutoff);
  const makePoint = (label, items) => {
    const buys = items.filter(x => x.side === 'buy');
    const sells = items.filter(x => x.side === 'sell');
    const sum = xs => xs.reduce((a,x) => a + (Number(x.usd_volume_estimate) || 0), 0);
    const buyVolume = sum(buys);
    const sellVolume = sum(sells);
    const wallets = new Set(items.map(x => String(x.wallet || '').toLowerCase()).filter(Boolean));
    return { label, buyVolume, sellVolume, volume: buyVolume + sellVolume, uniqueWallets: wallets.size };
  };

  if (days <= 1) {
    const out = [];
    const now = new Date();
    for (let i = 23; i >= 0; i--) {
      const end = new Date(now.getTime() - i * 3600000);
      end.setUTCMinutes(0,0,0);
      const start = new Date(end);
      const next = new Date(start.getTime() + 3600000);
      const items = filtered.filter(x => { const t=Date.parse(x.block_timestamp); return t >= start.getTime() && t < next.getTime(); });
      out.push(makePoint(start.toLocaleTimeString('en-US',{hour:'numeric',timeZone:'UTC'}), items));
    }
    return out;
  }

  if (days <= 30) {
    const out = [];
    const start = new Date(Date.now() - (days - 1) * DAY_MS);
    start.setUTCHours(0,0,0,0);
    for (let i=0;i<days;i++) {
      const d = new Date(start.getTime() + i * DAY_MS);
      const next = new Date(d.getTime() + DAY_MS);
      const items = filtered.filter(x => { const t=Date.parse(x.block_timestamp); return t >= d.getTime() && t < next.getTime(); });
      out.push(makePoint(d.toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'}), items));
    }
    return out;
  }

  // For a young token, 1Y means all available history up to one year.
  // Keep daily buckets while the indexed history is 30 days or younger; naturally
  // switch to monthly buckets as the dataset grows.
  if (filtered.length) {
    const first = Math.min(...filtered.map(x => Date.parse(x.block_timestamp)).filter(Number.isFinite));
    const availableDays = Math.max(1, Math.ceil((Date.now() - first) / DAY_MS));
    if (availableDays <= 30) {
      const out = [];
      const start = new Date(first);
      start.setUTCHours(0,0,0,0);
      const today = new Date();
      today.setUTCHours(0,0,0,0);
      for (let d = new Date(start); d <= today; d = new Date(d.getTime() + DAY_MS)) {
        const next = new Date(d.getTime() + DAY_MS);
        const items = filtered.filter(x => { const t=Date.parse(x.block_timestamp); return t >= d.getTime() && t < next.getTime(); });
        out.push(makePoint(d.toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'}), items));
      }
      return out;
    }
  }

  const now = new Date();
  return Array.from({length:12}, (_, idx) => {
    const i = 11 - idx;
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const items = filtered.filter(x => { const t=Date.parse(x.block_timestamp); return t >= start.getTime() && t < end.getTime(); });
    return makePoint(start.toLocaleDateString('en-US',{month:'short',timeZone:'UTC'}), items);
  });
}

module.exports = {
  backfillChunk,
  getMarket,
  getState,
  initializeBackfill,
  processRange,
  readSwapsSince,
  summarize,
  buildActivitySeries,
  syncForward,
};
