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
        ok: true
      };
    } catch (e) {
      lastError = e;
    }
  }
  return { volume24h:null, marketPairs:0, ok:false, error:String(lastError?.message || lastError) };
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

async function getTreasuryInflows() {
  // TA's published treasury is primarily native ETH. Read normal address
  // transactions and count successful inbound native-value transfers.
  let items = [];
  let next = null;
  let pages = 0;
  let lastError = null;

  try {
    do {
      const u = new URL(`${EXPLORER}/api/v2/addresses/${TREASURY}/transactions`);
      if (next && typeof next === 'object') {
        Object.entries(next).forEach(([k,v]) => { if (v != null) u.searchParams.set(k, String(v)); });
      }
      const json = await getJson(u.toString());
      const rows = Array.isArray(json?.items) ? json.items : [];
      items.push(...rows);
      next = json?.next_page_params || null;
      pages += 1;
      if (pages >= 12) next = null;
      const oldest = rows.map(transferTimestamp).filter(Boolean).sort((a,b)=>a-b)[0];
      if (oldest && oldest.getTime() < rangeStart(30).getTime()) next = null;
    } while (next);
  } catch (e) {
    lastError = e;
  }

  if (!items.length) {
    return {ok:false, records:[], error:String(lastError?.message || lastError || 'No treasury transactions returned')};
  }

  const records = [];
  for (const x of items) {
    const to = String(x?.to?.hash || x?.to?.address || x?.to || '').toLowerCase();
    if (to !== TREASURY.toLowerCase()) continue;
    if (String(x?.status || '').toLowerCase() === 'error') continue;

    const date = transferTimestamp(x);
    const eth = nativeAmount(x?.value);
    if (!date || eth == null || eth <= 0) continue;

    // Blockscout transaction responses can include exchange_rate for the
    // native coin. Use that transaction response value instead of assuming a fee %.
    const exchangeRate = num(x?.exchange_rate ?? x?.exchangeRate);
    const usd = exchangeRate != null && exchangeRate > 0 ? eth * exchangeRate : null;
    records.push({date, eth, usd});
  }

  const hasUsd = records.some(r => r.usd != null);
  return {
    ok: records.length > 0,
    usdAvailable: hasUsd,
    records,
    error: records.length ? null : String(lastError?.message || lastError || 'No inbound native treasury transfers found')
  };
}

function treasuryDays(records, days) {
  const start = rangeStart(days).getTime();
  const xs = records.filter(x => x.date.getTime() >= start);
  const usdRows = xs.filter(x => x.usd != null);
  return {
    eth: xs.reduce((sum,x) => sum + (x.eth || 0), 0),
    usd: usdRows.length ? usdRows.reduce((sum,x) => sum + x.usd, 0) : null,
    count: xs.length
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
          treasuryAddedNote: treasuryFlows.ok ? (t24.usd != null ? `${t24.count} inbound native ETH transfer${t24.count === 1 ? '' : 's'} in this period` : `${t24.eth.toFixed(4)} ETH received · USD rate unavailable`) : 'Treasury transaction source unavailable',
          newHolders: holders.newHolders24h,
          newHoldersNote: holders.note,
          series: buildSeries(fund.records, 1)
        },
        '7d': {
          volume: null,
          volumeAvailable: false,
          volumeNote: '7D volume requires historical snapshots',
          ...r7,
          treasuryAdded: treasuryFlows.ok ? t7.usd : null,
          treasuryAddedEth: treasuryFlows.ok ? t7.eth : null,
          treasuryAddedNote: treasuryFlows.ok ? (t7.usd != null ? `${t7.count} inbound native ETH transfer${t7.count === 1 ? '' : 's'} in this period` : `${t7.eth.toFixed(4)} ETH received · USD rate unavailable`) : 'Treasury transaction source unavailable',
          newHolders: holders.newHolders7d,
          newHoldersNote: holders.note,
          series: buildSeries(fund.records, 7)
        },
        '30d': {
          volume: null,
          volumeAvailable: false,
          volumeNote: '30D volume requires historical snapshots',
          ...r30,
          treasuryAdded: treasuryFlows.ok ? t30.usd : null,
          treasuryAddedEth: treasuryFlows.ok ? t30.eth : null,
          treasuryAddedNote: treasuryFlows.ok ? (t30.usd != null ? `${t30.count} inbound native ETH transfer${t30.count === 1 ? '' : 's'} in this period` : `${t30.eth.toFixed(4)} ETH received · USD rate unavailable`) : 'Treasury transaction source unavailable',
          newHolders: holders.newHolders30d,
          newHoldersNote: holders.note,
          series: buildSeries(fund.records, 30)
        }
      },
      sourceStatus: {
        market: market.ok,
        fund: fund.ok,
        holders: holders.ok,
        treasuryFlows: treasuryFlows.ok,
        marketError: market.error || null,
        fundErrors: fund.errors,
        holderError: holders.error || null,
        treasuryFlowError: treasuryFlows.error || null
      },
      updatedAt: new Date().toISOString()
    });
  } catch (e) {
    console.error('dashboard fatal error', e);
    return res.status(500).json({ ok:false, error:String(e?.message || e) });
  }
};
