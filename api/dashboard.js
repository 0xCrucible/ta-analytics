const TOKEN = '0x9ca1cc0c90d97b4f36c5e2232d4fbd705a73c65d';
const TA_BASE = 'https://ta.fund';
const TREASURY = '0x1F41B0441ae6E00633Bd2E6607218d370DA4896e';
const EXPLORER = 'https://robinhoodchain.blockscout.com';
const STATE_ABBR = {
  Alabama:'AL', Alaska:'AK', Arizona:'AZ', Arkansas:'AR', California:'CA', Colorado:'CO', Connecticut:'CT', Delaware:'DE', Florida:'FL', Georgia:'GA', Hawaii:'HI', Idaho:'ID', Illinois:'IL', Indiana:'IN', Iowa:'IA', Kansas:'KS', Kentucky:'KY', Louisiana:'LA', Maine:'ME', Maryland:'MD', Massachusetts:'MA', Michigan:'MI', Minnesota:'MN', Mississippi:'MS', Missouri:'MO', Montana:'MT', Nebraska:'NE', Nevada:'NV', 'New Hampshire':'NH', 'New Jersey':'NJ', 'New Mexico':'NM', 'New York':'NY', 'North Carolina':'NC', 'North Dakota':'ND', Ohio:'OH', Oklahoma:'OK', Oregon:'OR', Pennsylvania:'PA', 'Rhode Island':'RI', 'South Carolina':'SC', 'South Dakota':'SD', Tennessee:'TN', Texas:'TX', Utah:'UT', Vermont:'VT', Virginia:'VA', Washington:'WA', 'West Virginia':'WV', Wisconsin:'WI', Wyoming:'WY', 'District of Columbia':'DC'
};
const STATE_PATTERN = Object.keys(STATE_ABBR).sort((a,b) => b.length - a.length).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

const HOLDER_APIS = [
  // Blockscout token-info endpoint. A successful response includes `holders_count`.
  `https://robinhoodchain.blockscout.com/api/v2/tokens/${TOKEN}`,
  // Alternate Robinhood Chain explorer hostname, if enabled.
  `https://explorer.robinhoodchain.com/api/v2/tokens/${TOKEN}`
];

const strip = (s = '') => s
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&#x27;|&#39;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

const num = (s) => {
  // Missing API fields must stay missing. Number('') is 0 in JavaScript,
  // which previously caused an unavailable holder count to display as zero.
  if (s === null || s === undefined || String(s).trim() === '') return null;
  const n = Number(String(s).replace(/[$,%]/g, '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

const months = {January:0,February:1,March:2,April:3,May:4,June:5,July:6,August:7,September:8,October:9,November:10,December:11};
function parseDate(s) {
  const m = String(s).match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})/);
  return m ? new Date(Date.UTC(+m[3], months[m[1]], +m[2], 12)) : null;
}
const dayKey = d => d.toISOString().slice(0,10);
function rangeStart(days) {
  const d = new Date();
  d.setUTCHours(0,0,0,0);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d;
}
function buildSeries(records, days) {
  const out = [];
  const start = rangeStart(days);
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const xs = records.filter(x => dayKey(x.date) === dayKey(d));
    out.push({
      label: d.toLocaleDateString('en-US', {timeZone:'UTC', month:'short', day:'numeric'}),
      amount: xs.reduce((a,x) => a + x.amount, 0),
      count: xs.length
    });
  }
  return out;
}
function sumDays(records, days) {
  const start = rangeStart(days).getTime();
  const xs = records.filter(x => x.date.getTime() >= start);
  return { donations: xs.reduce((a,x) => a + x.amount, 0), donationCount: xs.length };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getText(url) {
  const r = await fetchWithTimeout(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; TAMetrics/1.0)',
      accept: 'text/html,application/xhtml+xml'
    }
  });
  if (!r.ok) throw new Error(`${url} returned ${r.status}`);
  return r.text();
}

async function getJson(url) {
  const r = await fetchWithTimeout(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${url} returned ${r.status}`);
  return r.json();
}

async function getMarket() {
  const urls = [
    `https://api.dexscreener.com/tokens/v1/robinhood/${TOKEN}`,
    `https://api.dexscreener.com/latest/dex/search?q=${TOKEN}`
  ];
  let lastError;
  for (const url of urls) {
    try {
      const json = await getJson(url);
      const all = Array.isArray(json) ? json : (Array.isArray(json?.pairs) ? json.pairs : []);
      const pairs = all.filter(p =>
        String(p?.baseToken?.address || '').toLowerCase() === TOKEN ||
        String(p?.quoteToken?.address || '').toLowerCase() === TOKEN
      );
      if (!pairs.length) throw new Error('No TA pairs returned');
      return {
        volume24h: pairs.reduce((a,p) => a + (Number(p?.volume?.h24) || 0), 0),
        marketPairs: pairs.length,
        pairAddresses: [...new Set(pairs.map(p => String(p?.pairAddress || '').toLowerCase()).filter(Boolean))],
        tokenPriceUsd: (() => {
          const ranked = [...pairs].sort((a,b) => (Number(b?.liquidity?.usd)||0) - (Number(a?.liquidity?.usd)||0));
          const p = ranked.find(x => String(x?.baseToken?.address || '').toLowerCase() === TOKEN)?.priceUsd
            || ranked.find(x => String(x?.quoteToken?.address || '').toLowerCase() === TOKEN)?.priceUsd;
          const n = Number(p);
          return Number.isFinite(n) && n > 0 ? n : null;
        })(),
        ok: true
      };
    } catch (e) {
      lastError = e;
    }
  }
  return { volume24h:null, marketPairs:0, pairAddresses:[], tokenPriceUsd:null, ok:false, error:String(lastError?.message || lastError) };
}



function nativeAmount(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n / 1e18 : null;
}

function transferTimestamp(item) {
  const v = item?.timestamp || item?.block_timestamp || item?.timeStamp;
  if (v == null) return null;
  if (/^\d+$/.test(String(v))) {
    const n = Number(v);
    return new Date(n < 1e12 ? n * 1000 : n);
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function txTo(item) {
  return String(item?.to?.hash || item?.to?.address || item?.to || '').toLowerCase();
}

function txFailed(item) {
  const status = String(item?.status || '').toLowerCase();
  const isError = String(item?.isError ?? item?.is_error ?? '').toLowerCase();
  return status === 'error' || status === 'failed' || isError === '1' || isError === 'true';
}

async function getNativeUsdPrice() {
  const urls = [
    `${EXPLORER}/api?module=stats&action=coinprice`,
    `${EXPLORER}/api?module=stats&action=ethprice`,
    `${EXPLORER}/api/v2/stats`
  ];
  let lastError = null;
  for (const url of urls) {
    try {
      const json = await getJson(url);
      const price = num(
        json?.result?.coin_usd ??
        json?.result?.ethusd ??
        json?.coin_price ??
        json?.coinPrice ??
        json?.exchange_rate ??
        json?.exchangeRate
      );
      if (price != null && price > 0) return { ok:true, price, source:url };
    } catch (e) {
      lastError = e;
    }
  }
  return { ok:false, price:null, error:String(lastError?.message || lastError || 'Native USD price unavailable') };
}

async function getV2AddressRows(kind) {
  const path = kind === 'internal' ? 'internal-transactions' : 'transactions';
  const rows = [];
  let next = null;
  let pages = 0;

  do {
    const u = new URL(`${EXPLORER}/api/v2/addresses/${TREASURY}/${path}`);
    if (next && typeof next === 'object') {
      Object.entries(next).forEach(([k,v]) => { if (v != null) u.searchParams.set(k, String(v)); });
    }
    const json = await getJson(u.toString());
    const pageRows = Array.isArray(json?.items) ? json.items : [];
    rows.push(...pageRows);
    next = json?.next_page_params || null;
    pages += 1;

    // We only need 30 days of history for the longest dashboard window.
    const oldest = pageRows.map(transferTimestamp).filter(Boolean).sort((a,b)=>a-b)[0];
    if (oldest && oldest.getTime() < rangeStart(31).getTime()) next = null;
    if (pages >= 20) next = null;
  } while (next);

  return rows;
}

async function getLegacyAddressRows(kind) {
  const action = kind === 'internal' ? 'txlistinternal' : 'txlist';
  const u = new URL(`${EXPLORER}/api`);
  u.searchParams.set('module', 'account');
  u.searchParams.set('action', action);
  u.searchParams.set('address', TREASURY);
  u.searchParams.set('startblock', '0');
  u.searchParams.set('endblock', '99999999');
  u.searchParams.set('page', '1');
  u.searchParams.set('offset', '1000');
  u.searchParams.set('sort', 'desc');
  const json = await getJson(u.toString());
  return Array.isArray(json?.result) ? json.result : [];
}

async function loadTreasuryRows(kind) {
  const errors = [];
  try {
    const rows = await getV2AddressRows(kind);
    if (rows.length) return { rows, source:`v2-${kind}`, errors };
  } catch (e) {
    errors.push(`v2 ${kind}: ${String(e.message || e)}`);
  }

  try {
    const rows = await getLegacyAddressRows(kind);
    if (rows.length) return { rows, source:`legacy-${kind}`, errors };
  } catch (e) {
    errors.push(`legacy ${kind}: ${String(e.message || e)}`);
  }

  return { rows:[], source:null, errors };
}

async function getTreasuryInflows() {
  // Fee revenue can arrive as either a direct native transfer or an internal
  // native transfer created during a contract call, so inspect both streams.
  const [normal, internal, priceInfo] = await Promise.all([
    loadTreasuryRows('normal'),
    loadTreasuryRows('internal'),
    getNativeUsdPrice()
  ]);

  const records = [];
  const seen = new Set();
  const candidates = [
    ...normal.rows.map((x) => ({...x, _kind:'normal'})),
    ...internal.rows.map((x) => ({...x, _kind:'internal'}))
  ];

  for (const x of candidates) {
    if (txTo(x) !== TREASURY.toLowerCase()) continue;
    if (txFailed(x)) continue;

    const date = transferTimestamp(x);
    const eth = nativeAmount(x?.value);
    if (!date || eth == null || eth <= 0) continue;

    // Dedupe identical explorer rows while retaining genuine separate internal calls.
    const hash = String(x?.hash || x?.transaction_hash || x?.transactionHash || '');
    const trace = String(x?.index ?? x?.trace_index ?? x?.transaction_index ?? x?._kind ?? '');
    const key = `${x._kind}:${hash}:${trace}:${x?.value}:${date.toISOString()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const txRate = num(x?.exchange_rate ?? x?.exchangeRate);
    const usdRate = txRate != null && txRate > 0 ? txRate : priceInfo.price;
    records.push({
      date,
      eth,
      usd: usdRate != null ? eth * usdRate : null,
      usdRate,
      valuation: txRate != null && txRate > 0 ? 'transaction-rate' : (priceInfo.price != null ? 'current-rate' : null),
      kind:x._kind
    });
  }

  records.sort((a,b) => b.date - a.date);
  const errors = [...normal.errors, ...internal.errors];
  if (!priceInfo.ok && priceInfo.error) errors.push(`native price: ${priceInfo.error}`);

  return {
    ok: records.length > 0,
    usdAvailable: records.some(r => r.usd != null),
    records,
    nativeUsdPrice: priceInfo.price,
    sources: [normal.source, internal.source].filter(Boolean),
    error: records.length ? null : (errors.join(' | ') || 'No treasury fee transfers found')
  };
}

function treasuryDays(records, days) {
  const start = rangeStart(days).getTime();
  const xs = records.filter(x => x.date.getTime() >= start);
  const usdRows = xs.filter(x => x.usd != null);
  const usedCurrentPrice = xs.some(x => x.valuation === 'current-rate');
  return {
    eth: xs.reduce((sum,x) => sum + (x.eth || 0), 0),
    usd: usdRows.length ? usdRows.reduce((sum,x) => sum + x.usd, 0) : null,
    count: xs.length,
    usedCurrentPrice
  };
}

async function parseContributionPage(pageUrl) {
  const html = await getText(pageUrl);
  const text = strip(html);
  const records = [];
  const re = new RegExp(`(TA-\\d{4}-\\d{6})\\s+(${STATE_PATTERN})\\s+\\$([\\d,.]+)\\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2},\\s+\\d{4})`, 'g');
  let m;
  while ((m = re.exec(text))) {
    const date = parseDate(m[4]);
    const amount = num(m[3]);
    if (date && amount != null) records.push({ id:m[1], state:m[2], amount, date });
  }
  const pages = Number(text.match(/Page\s+\d+\s+of\s+(\d+)/i)?.[1] || 1);
  return { records, pages };
}

function summarizeStates(records) {
  const grouped = new Map();
  for (const r of records) {
    if (!r.state) continue;
    if (!grouped.has(r.state)) grouped.set(r.state, []);
    grouped.get(r.state).push(r);
  }
  return [...grouped.entries()].map(([state, rows]) => ({
    state,
    abbr: STATE_ABBR[state] || '',
    count: rows.length,
    total: rows.reduce((sum, r) => sum + r.amount, 0),
    donations: rows
      .sort((a,b) => b.date - a.date)
      .map(r => ({
        id:r.id,
        amount:r.amount,
        date:r.date.toISOString(),
        dateLabel:r.date.toLocaleDateString('en-US', { timeZone:'UTC', month:'short', day:'numeric' })
      }))
  })).sort((a,b) => b.total - a.total || b.count - a.count || a.state.localeCompare(b.state));
}

async function getFund() {
  let transparency = '';
  const errors = [];
  try { transparency = strip(await getText(`${TA_BASE}/transparency`)); }
  catch (e) { errors.push(`transparency: ${String(e.message || e)}`); }

  const treasuryMatch = transparency.match(/Current Treasury\s*\$([\d,.]+)/i);
  const totalMatch = transparency.match(/Total contributed\s*\$([\d,.]+)/i) || transparency.match(/\$([\d,.]+)\s*Total contributed/i);
  const accountsMatch = transparency.match(/Accounts funded\s*(\d+)/i) || transparency.match(/(\d+)\s*Accounts funded/i);

  const all = [];
  try {
    const first = await parseContributionPage(`${TA_BASE}/contributions`);
    all.push(...first.records);
    for (let page = 2; page <= Math.min(first.pages, 20); page += 1) {
      try {
        const next = await parseContributionPage(`${TA_BASE}/contributions?page=${page}`);
        all.push(...next.records);
      } catch (e) {
        errors.push(`contributions page ${page}: ${String(e.message || e)}`);
      }
    }
  } catch (e) {
    errors.push(`contributions: ${String(e.message || e)}`);
  }

  // The responsive page can repeat the same record in table and card markup.
  const unique = new Map();
  for (const r of all) unique.set(r.id, r);
  const records = [...unique.values()].sort((a,b) => b.date - a.date);
  const stateSummary = summarizeStates(records);

  return {
    treasury: num(treasuryMatch?.[1]),
    totalContributed: num(totalMatch?.[1]),
    accountsFunded: Number(accountsMatch?.[1] || 0) || null,
    records,
    stateSummary,
    stateContributionCount: records.length,
    stateContributionTotal: records.reduce((sum,r) => sum + r.amount, 0),
    ok: Boolean(transparency || records.length),
    errors
  };
}

function readNested(obj, paths) {
  for (const path of paths) {
    const parts = path.split('.');
    let cur = obj;
    for (const part of parts) cur = cur?.[part];
    const n = num(cur);
    if (n != null) return n;
  }
  return null;
}



function rollingStartMs(days) {
  return Date.now() - (days * 24 * 60 * 60 * 1000);
}

function legacyTokenTransferDate(item) {
  const v = item?.timeStamp ?? item?.timestamp;
  if (v == null) return null;
  const raw = String(v);
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    const d = new Date(n < 1e12 ? n * 1000 : n);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function getAllTokenTransfersLegacy() {
  // Blockscout's Etherscan-compatible tokentx endpoint supports filtering by
  // contract address and returns up to 10,000 ERC-20 transfer events per page.
  // Fetch oldest-first so the first time an address appears as a recipient is
  // deterministic.
  const rows = [];
  const pageSize = 10000;
  const maxPages = 8;

  for (let page = 1; page <= maxPages; page += 1) {
    const u = new URL(`${EXPLORER}/api`);
    u.searchParams.set('module', 'account');
    u.searchParams.set('action', 'tokentx');
    u.searchParams.set('contractaddress', TOKEN);
    u.searchParams.set('page', String(page));
    u.searchParams.set('offset', String(pageSize));
    u.searchParams.set('sort', 'asc');

    const json = await getJson(u.toString());
    const batch = Array.isArray(json?.result) ? json.result : [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }

  return rows;
}

async function getRecentTokenTransfersLegacy(days = 31) {
  // Pull newest transfers first and stop once we have crossed the longest
  // rolling window used by the dashboard.
  const rows = [];
  const pageSize = 10000;
  const maxPages = 10;
  const cutoff = rollingStartMs(days);

  for (let page = 1; page <= maxPages; page += 1) {
    const u = new URL(`${EXPLORER}/api`);
    u.searchParams.set('module', 'account');
    u.searchParams.set('action', 'tokentx');
    u.searchParams.set('contractaddress', TOKEN);
    u.searchParams.set('page', String(page));
    u.searchParams.set('offset', String(pageSize));
    u.searchParams.set('sort', 'desc');

    const json = await getJson(u.toString());
    const batch = Array.isArray(json?.result) ? json.result : [];
    rows.push(...batch);
    if (batch.length < pageSize) break;

    const dates = batch.map(legacyTokenTransferDate).filter(Boolean);
    const oldest = dates.length ? Math.min(...dates.map(d => d.getTime())) : null;
    if (oldest != null && oldest < cutoff) break;
  }
  return rows;
}

async function getWalletActivityStats(pairAddresses = [], tokenPriceUsd = null) {
  try {
    const pools = new Set((pairAddresses || []).map(x => String(x).toLowerCase()).filter(Boolean));
    if (!pools.size) throw new Error('No TA liquidity-pool addresses returned by market source');

    const transfers = await getRecentTokenTransfersLegacy(31);
    if (!transfers.length) throw new Error('No recent TA transfer history returned');

    const zero = '0x0000000000000000000000000000000000000000';
    const tokenAddr = TOKEN.toLowerCase();
    const activity = [];

    const tokenAmount = (item) => {
      const raw = Number(item?.value);
      const decimals = Number(item?.tokenDecimal ?? 18);
      if (!Number.isFinite(raw) || !Number.isFinite(decimals)) return null;
      const amount = raw / (10 ** decimals);
      return Number.isFinite(amount) ? amount : null;
    };

    for (const item of transfers) {
      const from = String(item?.from || '').toLowerCase();
      const to = String(item?.to || '').toLowerCase();
      const date = legacyTokenTransferDate(item);
      const amountTa = tokenAmount(item);
      if (!date || amountTa == null || amountTa <= 0) continue;

      // Pool -> address = buy-side TA outflow. Address -> pool = sell-side TA inflow.
      if (pools.has(from) && to && to !== zero && !pools.has(to) && to !== tokenAddr) {
        activity.push({ side:'buy', wallet:to, date, amountTa });
      } else if (pools.has(to) && from && from !== zero && !pools.has(from) && from !== tokenAddr) {
        activity.push({ side:'sell', wallet:from, date, amountTa });
      }
    }

    const statsSince = (days) => {
      const start = rollingStartMs(days);
      const rows = activity.filter(x => x.date.getTime() >= start);
      const buyTa = rows.filter(x => x.side === 'buy').reduce((a,x) => a + x.amountTa, 0);
      const sellTa = rows.filter(x => x.side === 'sell').reduce((a,x) => a + x.amountTa, 0);
      const wallets = new Set(rows.map(x => x.wallet));
      return {
        uniqueWallets: wallets.size,
        buyVolume: tokenPriceUsd != null ? buyTa * tokenPriceUsd : null,
        sellVolume: tokenPriceUsd != null ? sellTa * tokenPriceUsd : null,
        buyTa,
        sellTa
      };
    };

    return {
      ok: true,
      '24h': statsSince(1),
      '7d': statsSince(7),
      '30d': statsSince(30),
      transferRows: transfers.length,
      activityRows: activity.length,
      poolsChecked: [...pools],
      note: tokenPriceUsd != null
        ? 'Buy and sell volume estimated from TA moved through tracked pools at the current TA/USD price.'
        : 'Wallet activity identified from TA transfers through tracked pools; USD volume unavailable because token price was unavailable.',
      walletNote: 'Distinct addresses with TA buy or sell activity through tracked liquidity pools during this rolling period.'
    };
  } catch (e) {
    return {
      ok: false,
      '24h': {uniqueWallets:null,buyVolume:null,sellVolume:null},
      '7d': {uniqueWallets:null,buyVolume:null,sellVolume:null},
      '30d': {uniqueWallets:null,buyVolume:null,sellVolume:null},
      note: 'Buy/sell activity data unavailable from the explorer right now.',
      walletNote: 'Unique wallet activity unavailable from the explorer right now.',
      error: String(e?.message || e)
    };
  }
}

async function getHolders() {
  let lastError;
  for (const url of HOLDER_APIS) {
    try {
      const json = await getJson(url);
      const totalHolders = readNested(json, [
        'holders',
        'holders_count',
        'holdersCount',
        'result.holders',
        'result.holders_count',
        'result.token.holders',
        'token.holders_count'
      ]);
      if (totalHolders != null) {
        return {
          totalHolders,
          newHolders24h: null,
          newHolders7d: null,
          newHolders30d: null,
          ok: true,
          note: 'Total holder count from public explorer data. New-holder history is not published by the current source.'
        };
      }
    } catch (e) {
      lastError = e;
    }
  }
  return {
    totalHolders: null,
    newHolders24h: null,
    newHolders7d: null,
    newHolders30d: null,
    ok: false,
    note: 'Holder metrics unavailable from the current public source.',
    error: String(lastError?.message || lastError || '')
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const [market, fund, holders, treasuryFlows] = await Promise.all([getMarket(), getFund(), getHolders(), getTreasuryInflows()]);
    const walletActivity = await getWalletActivityStats(market.pairAddresses || [], market.tokenPriceUsd);
    const r24 = sumDays(fund.records, 1);
    const r7 = sumDays(fund.records, 7);
    const r30 = sumDays(fund.records, 30);
    const t24 = treasuryDays(treasuryFlows.records, 1);
    const t7 = treasuryDays(treasuryFlows.records, 7);
    const t30 = treasuryDays(treasuryFlows.records, 30);

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({
      ok: true,
      treasury: fund.treasury,
      totalContributed: fund.totalContributed,
      accountsFunded: fund.accountsFunded,
      stateSummary: fund.stateSummary,
      stateContributionCount: fund.stateContributionCount,
      stateContributionTotal: fund.stateContributionTotal,
      totalHolders: holders.totalHolders,
      holdersAvailable: holders.ok,
      marketPairs: market.marketPairs,
      ranges: {
        '24h': {
          volume: market.volume24h,
          volumeAvailable: market.ok,
          volumeNote: market.ok ? null : 'Live market source unavailable',
          ...r24,
          treasuryAdded: treasuryFlows.ok ? t24.usd : null,
          treasuryAddedEth: treasuryFlows.ok ? t24.eth : null,
          treasuryAddedNote: treasuryFlows.ok ? (t24.usd != null ? 'Trading fees received by the treasury during this period' : 'Trading fees received · USD value unavailable') : 'Treasury fee data unavailable',
          buyVolume: walletActivity['24h'].buyVolume,
          sellVolume: walletActivity['24h'].sellVolume,
          uniqueWallets: walletActivity['24h'].uniqueWallets,
          tradeActivityNote: walletActivity.note,
          uniqueWalletsNote: walletActivity.walletNote,
          series: buildSeries(fund.records, 1)
        },
        '7d': {
          volume: null,
          volumeAvailable: false,
          volumeNote: '7D volume requires historical snapshots',
          ...r7,
          treasuryAdded: treasuryFlows.ok ? t7.usd : null,
          treasuryAddedEth: treasuryFlows.ok ? t7.eth : null,
          treasuryAddedNote: treasuryFlows.ok ? (t7.usd != null ? 'Trading fees received by the treasury during this period' : 'Trading fees received · USD value unavailable') : 'Treasury fee data unavailable',
          buyVolume: walletActivity['7d'].buyVolume,
          sellVolume: walletActivity['7d'].sellVolume,
          uniqueWallets: walletActivity['7d'].uniqueWallets,
          tradeActivityNote: walletActivity.note,
          uniqueWalletsNote: walletActivity.walletNote,
          series: buildSeries(fund.records, 7)
        },
        '30d': {
          volume: null,
          volumeAvailable: false,
          volumeNote: '30D volume requires historical snapshots',
          ...r30,
          treasuryAdded: treasuryFlows.ok ? t30.usd : null,
          treasuryAddedEth: treasuryFlows.ok ? t30.eth : null,
          treasuryAddedNote: treasuryFlows.ok ? (t30.usd != null ? 'Trading fees received by the treasury during this period' : 'Trading fees received · USD value unavailable') : 'Treasury fee data unavailable',
          buyVolume: walletActivity['30d'].buyVolume,
          sellVolume: walletActivity['30d'].sellVolume,
          uniqueWallets: walletActivity['30d'].uniqueWallets,
          tradeActivityNote: walletActivity.note,
          uniqueWalletsNote: walletActivity.walletNote,
          series: buildSeries(fund.records, 30)
        }
      },
      sourceStatus: {
        market: market.ok,
        fund: fund.ok,
        holders: holders.ok,
        walletActivity: walletActivity.ok,
        treasuryFlows: treasuryFlows.ok,
        marketError: market.error || null,
        fundErrors: fund.errors,
        holderError: holders.error || null,
        walletActivityError: walletActivity.error || null,
        walletActivityRows: walletActivity.activityRows ?? null,
        walletActivityTransferRows: walletActivity.transferRows ?? null,
        walletActivityPoolsChecked: walletActivity.poolsChecked || [],
        tokenPriceUsd: market.tokenPriceUsd ?? null,
        treasuryFlowError: treasuryFlows.error || null,
        treasuryFlowSources: treasuryFlows.sources || [],
        nativeUsdPrice: treasuryFlows.nativeUsdPrice ?? null
      },
      updatedAt: new Date().toISOString()
    });
  } catch (e) {
    console.error('dashboard fatal error', e);
    return res.status(500).json({ ok:false, error:String(e?.message || e) });
  }
};
