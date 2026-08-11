const money = (n, compact = false) => {
  if (n == null || !Number.isFinite(+n)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 2 : 0
  }).format(+n);
};

const integer = (n) => {
  if (n == null || !Number.isFinite(+n)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(+n);
};

const el = (id) => document.getElementById(id);
let DATA = null;
let RANGE = '24h';
let METRIC = 'volume';

const RANGE_COPY = {
  '24h': { label: '24H', title: 'Last 24 hours' },
  '7d': { label: '7D', title: 'Last 7 days' },
  '30d': { label: '30D', title: 'Last 30 days' },
  '1y': { label: '1Y', title: 'Up to 1 year' }
};

const METRIC_COPY = {
  volume: { label: 'TRADING VOLUME', legend: 'Trading volume', kind: 'money', source: 'activitySeries', key: 'volume' },
  donations: { label: 'DONATIONS MADE', legend: 'Published donations', kind: 'money', source: 'series', key: 'amount' },
  treasuryAdded: { label: 'TRADING FEES TO TREASURY', legend: 'Trading fees to treasury', kind: 'money', source: 'treasurySeries', key: 'amount' },
  buyVolume: { label: 'BUY VOLUME', legend: 'Buy volume', kind: 'money', source: 'activitySeries', key: 'buyVolume' },
  sellVolume: { label: 'SELL VOLUME', legend: 'Sell volume', kind: 'money', source: 'activitySeries', key: 'sellVolume' },
  uniqueWallets: { label: 'UNIQUE WALLETS', legend: 'Unique trading wallets', kind: 'integer', source: 'activitySeries', key: 'uniqueWallets' }
};

function renderStates(d) {
  const states = Array.isArray(d.stateSummary) ? d.stateSummary : [];
  el('statesReached').textContent = integer(states.length);
  el('statesMetricCount').textContent = integer(states.length);
  el('stateDonationCount').textContent = integer(d.stateContributionCount ?? states.reduce((n, s) => n + (s.count || 0), 0));
  el('stateDonationTotal').textContent = money(d.stateContributionTotal ?? states.reduce((n, s) => n + (s.total || 0), 0));

  const grid = el('statesGrid');
  grid.innerHTML = '';
  if (!states.length) {
    grid.innerHTML = '<div class="states-loading">State data is temporarily unavailable.</div>';
    return;
  }

  states.forEach((state) => {
    const card = document.createElement('article');
    card.className = 'state-card';
    card.innerHTML = `
      <div class="state-card__top">
        <div class="state-name-wrap">
          <div class="state-abbr">${state.abbr || ''}</div>
          <h3>${state.state}</h3>
        </div>
        <div class="state-total-wrap">
          <span>Total donated</span>
          <strong class="state-total">${money(state.total)}</strong>
        </div>
      </div>
      <div class="state-stats">
        <span>Donations</span>
        <strong>${integer(state.count)}</strong>
      </div>`;
    grid.appendChild(card);
  });
}

function openStates() {
  const modal = el('statesModal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  el('closeStates').focus();
}

function closeStates() {
  const modal = el('statesModal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  el('openStates').focus();
}

function chartRows(rangeData, metric) {
  const cfg = METRIC_COPY[metric];
  const rows = Array.isArray(rangeData?.[cfg.source]) ? rangeData[cfg.source] : [];
  const mapped = rows.map((row) => ({ label: row.label || '', value: Number(row[cfg.key]) || 0 }));
  const hasPositive = mapped.some((row) => row.value > 0);

  // If historical trade indexing is not populated yet, do not draw a misleading
  // flat-zero volume chart. Show the live DEX volume we actually have instead.
  if (metric === 'volume' && !hasPositive && Number(rangeData?.volume) > 0) {
    return [{
      label: rangeData?.volumePartial ? 'Latest 24H' : (RANGE_COPY[RANGE]?.label || 'Available'),
      value: Number(rangeData.volume)
    }];
  }

  return mapped;
}

function drawMetricChart(rangeData) {
  const cfg = METRIC_COPY[METRIC];
  const rows = chartRows(rangeData, METRIC);
  const chart = el('chart');
  chart.innerHTML = '';

  if (!rows.length) {
    const waitingForActivity = ['volume', 'buyVolume', 'sellVolume', 'uniqueWallets'].includes(METRIC);
    chart.innerHTML = `<div class="empty">${waitingForActivity ? 'Trade history has not been indexed for this period yet.' : 'No activity in this period.'}</div>`;
    return;
  }

  const max = Math.max(1, ...rows.map((x) => x.value));
  rows.forEach((r) => {
    const c = document.createElement('div');
    c.className = 'bar-col';
    const h = r.value > 0 ? Math.max(4, Math.round((r.value / max) * 220)) : 2;
    const formatted = cfg.kind === 'integer' ? integer(r.value) : money(r.value, true);
    c.innerHTML = `
      <span class="bar-val">${r.value ? formatted : ''}</span>
      <div class="bar${r.value ? '' : ' zero'}" style="height:${h}px"></div>
      <span class="bar-label">${r.label}</span>`;
    chart.appendChild(c);
  });
}

function renderChart() {
  if (!DATA?.ranges?.[RANGE]) return;
  const meta = RANGE_COPY[RANGE];
  const cfg = METRIC_COPY[METRIC];
  const r = DATA.ranges[RANGE];

  el('chartEyebrow').textContent = cfg.label;
  el('chartTitle').textContent = meta.title;
  el('chartLegend').textContent = cfg.legend;

  if (METRIC === 'volume') {
    el('chartNote').textContent = r.volumePartial
      ? `Partial history · latest 24H DEX volume shown while longer-range history accumulates.`
      : (r.activitySeries?.some((row) => Number(row.volume) > 0)
        ? `${cfg.legend} from indexed TA swap activity · ${meta.title.toLowerCase()}.`
        : `Live DEX volume · ${meta.title.toLowerCase()}.`);
  } else if (['buyVolume', 'sellVolume', 'uniqueWallets'].includes(METRIC)) {
    el('chartNote').textContent = r.activitySeries?.length
      ? `${cfg.legend} from indexed TA swap activity · ${meta.title.toLowerCase()}.`
      : `Waiting for indexed TA swap history · ${meta.title.toLowerCase()}.`;
  } else if (METRIC === 'treasuryAdded') {
    el('chartNote').textContent = `Treasury fee activity · ${meta.title.toLowerCase()}.`;
  } else {
    el('chartNote').textContent = `Published donation activity · ${meta.title.toLowerCase()}.`;
  }

  drawMetricChart(r);
}

function renderRange() {
  if (!DATA) return;
  const meta = RANGE_COPY[RANGE];
  const r = DATA.ranges[RANGE];

  el('volumePeriod').textContent = meta.label;
  el('donationPeriod').textContent = meta.label;
  el('treasuryAddedPeriod').textContent = meta.label;

  el('volume').textContent = money(r.volume, true);
  el('volumeSub').textContent = r.volumePartial
    ? (r.volumeNote || 'Partial history · latest 24H DEX volume shown')
    : (r.volumeAvailable
      ? `${DATA.marketPairs || 0} tracked TA market pair${DATA.marketPairs === 1 ? '' : 's'} · public DEX/on-chain data`
      : (r.volumeNote || 'Historical market volume not available yet'));

  el('treasuryAdded').textContent = money(r.treasuryAdded);
  el('treasuryAddedSub').textContent = r.treasuryAddedNote || 'Trading fees received by the treasury during this period';




  el('donations').textContent = money(r.donations);
  el('donationsSub').textContent = `${r.donationCount || 0} published donation${r.donationCount === 1 ? '' : 's'} in this period`;

  renderChart();
}

function render(d) {
  DATA = d;
  el('heroContributions').textContent = money(d.totalContributed);
  el('allTimeDonations').textContent = money(d.totalContributed);
  el('treasury').textContent = money(d.treasury);
  el('accountsFunded').textContent = integer(d.accountsFunded);
  el('accountsFundedHero').textContent = integer(d.accountsFunded);
  el('totalHolders').textContent = integer(d.totalHolders);
  renderStates(d);

  const updated = new Date(d.updatedAt || Date.now());
  const stamp = updated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  el('status').textContent = `Updated ${stamp}`;
  el('verifyMeta').textContent = `Last verified ${stamp} · ${updated.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;
  renderRange();
}

async function loadActivity() {
  try {
    const response = await fetch('/api/activity', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Activity API ${response.status}`);
    const activity = await response.json();
    if (!activity.ok) throw new Error(activity.error || 'Activity source unavailable');
    if (!DATA) return;

    for (const key of ['24h', '7d', '30d', '1y']) {
      const a = activity.ranges?.[key] || {};
      if (!DATA.ranges[key]) continue;
      DATA.ranges[key].buyVolume = a.buyVolume ?? null;
      DATA.ranges[key].sellVolume = a.sellVolume ?? null;
      DATA.ranges[key].uniqueWallets = a.uniqueWallets ?? null;
      DATA.ranges[key].activitySeries = Array.isArray(a.series) ? a.series : [];
      DATA.ranges[key].tradeActivityNote = activity.note;
      DATA.ranges[key].uniqueWalletsNote = activity.walletNote;
      if (key !== '24h' && a.volume != null && (Number(a.swapCount) > 0 || Number(a.volume) > 0)) {
        DATA.ranges[key].volume = a.volume;
        DATA.ranges[key].volumeAvailable = true;
        DATA.ranges[key].volumePartial = false;
        DATA.ranges[key].volumeNote = 'Estimated from indexed on-chain Uniswap v4 swaps';
      }
    }
    renderRange();
  } catch (error) {
    console.error('TA Metrics activity load failed:', error);
    if (!DATA) return;
    for (const key of ['24h', '7d', '30d', '1y']) {
      if (!DATA.ranges[key]) continue;
      DATA.ranges[key].tradeActivityNote = 'Trade activity temporarily unavailable';
      DATA.ranges[key].uniqueWalletsNote = 'Trade activity temporarily unavailable';
      DATA.ranges[key].activitySeries = [];
    }
    renderRange();
  }
}

async function load() {
  try {
    const r = await fetch('/api/dashboard', { cache: 'no-store' });
    if (!r.ok) throw new Error(`API ${r.status}`);
    const data = await r.json();
    console.log('TA Metrics source status:', data.sourceStatus);
    render(data);
    loadActivity();
  } catch (e) {
    console.error('TA Metrics dashboard load failed:', e);
    el('status').textContent = 'Data unavailable';
    el('verifyMeta').textContent = 'Could not reach /api/dashboard';
    el('donationsSub').textContent = 'Open /api/dashboard directly to diagnose';
    document.body.classList.add('error');
  }
}

function selectMetric(metric) {
  if (!METRIC_COPY[metric]) return;
  METRIC = metric;
  document.querySelectorAll('.metric-card[data-metric]').forEach((card) => {
    const active = card.dataset.metric === metric;
    card.classList.toggle('active-metric', active);
    card.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  renderChart();
}

document.querySelectorAll('.period-btn').forEach((btn) => btn.addEventListener('click', () => {
  RANGE = btn.dataset.range;
  document.querySelectorAll('.period-btn').forEach((b) => b.classList.toggle('active', b === btn));
  renderRange();
}));

document.querySelectorAll('.metric-card[data-metric]').forEach((card) => {
  card.addEventListener('click', (event) => {
    if (event.target.closest('a')) return;
    selectMetric(card.dataset.metric);
  });
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectMetric(card.dataset.metric);
    }
  });
});

load();
setInterval(load, 60000);

el('openStates').addEventListener('click', openStates);
el('closeStates').addEventListener('click', closeStates);
el('statesBackdrop').addEventListener('click', closeStates);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && el('statesModal').classList.contains('open')) closeStates();
});

const TA_CONTRACT = '0x9ca1cc0c90d97b4f36c5e2232d4fbd705a73c65d';
const copyContractButton = el('copyContract');
if (copyContractButton) {
  copyContractButton.addEventListener('click', async () => {
    const status = el('copyContractStatus');
    try {
      await navigator.clipboard.writeText(TA_CONTRACT);
      status.textContent = 'Copied';
      setTimeout(() => { status.textContent = 'Copy'; }, 1400);
    } catch (error) {
      status.textContent = TA_CONTRACT;
      copyContractButton.title = TA_CONTRACT;
    }
  });
}
