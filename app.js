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

const RANGE_COPY = {
  '24h': { label: '24H', title: 'Last 24 hours' },
  '7d': { label: '7D', title: 'Last 7 days' },
  '30d': { label: '30D', title: 'Last 30 days' }
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
        <div>
          <div class="state-abbr">${state.abbr || ''}</div>
          <h3>${state.state}</h3>
        </div>
        <div class="state-total">${money(state.total)}</div>
      </div>
      <div class="state-stats">
        <div>
          <span>Donations</span>
          <strong>${integer(state.count)}</strong>
        </div>
        <div>
          <span>Total donated</span>
          <strong>${money(state.total)}</strong>
        </div>
      </div>
    `;
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

function draw(rows) {
  const chart = el('chart');
  chart.innerHTML = '';
  if (!rows.length) {
    chart.innerHTML = '<div class="empty">No published donations in this period.</div>';
    return;
  }
  const max = Math.max(1, ...rows.map((x) => x.amount || 0));
  rows.forEach((r) => {
    const c = document.createElement('div');
    c.className = 'bar-col';
    const h = Math.max(4, Math.round(((r.amount || 0) / max) * 220));
    c.innerHTML = `
      <span class="bar-val">${r.amount ? money(r.amount, true) : ''}</span>
      <div class="bar" style="height:${h}px"></div>
      <span class="bar-label">${r.label}</span>
    `;
    chart.appendChild(c);
  });
}

function renderRange() {
  if (!DATA) return;
  const meta = RANGE_COPY[RANGE];
  const r = DATA.ranges[RANGE];

  el('volumePeriod').textContent = meta.label;
  el('donationPeriod').textContent = meta.label;
  el('treasuryAddedPeriod').textContent = meta.label;
  el('chartTitle').textContent = meta.title;

  el('volume').textContent = money(r.volume, true);
  el('volumeSub').textContent = r.volumeAvailable
    ? `${DATA.marketPairs || 0} tracked TA market pair${DATA.marketPairs === 1 ? '' : 's'} · public DEX data`
    : (r.volumeNote || 'Historical market volume not available yet');

  el('treasuryAdded').textContent = money(r.treasuryAdded);
  el('treasuryAddedSub').textContent = r.treasuryAddedNote || 'Trading fees received by the treasury during this period';

  el('donations').textContent = money(r.donations);
  el('donationsSub').textContent = `${r.donationCount || 0} published donation${r.donationCount === 1 ? '' : 's'} in this period`;

  el('chartNote').textContent = `Published donation activity · ${meta.title.toLowerCase()}.`;
  draw(r.series || []);
}

function render(d) {
  DATA = d;
  el('heroContributions').textContent = money(d.totalContributed);
  el('allTimeDonations').textContent = money(d.totalContributed);
  el('treasury').textContent = money(d.treasury);
  el('accountsFunded').textContent = integer(d.accountsFunded);
  el('accountsFundedHero').textContent = integer(d.accountsFunded);
  el('totalHolders').textContent = integer(d.totalHolders);
  el('totalHoldersHero').textContent = integer(d.totalHolders);
  renderStates(d);

  const updated = new Date(d.updatedAt || Date.now());
  const stamp = updated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  el('status').textContent = `Updated ${stamp}`;
  el('verifyMeta').textContent = `Last verified ${stamp} · ${updated.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;
  renderRange();
}

async function load() {
  try {
    const r = await fetch('/api/dashboard', { cache: 'no-store' });
    if (!r.ok) throw new Error(`API ${r.status}`);
    const data = await r.json();
    console.log('TA Metrics source status:', data.sourceStatus);
    render(data);
  } catch (e) {
    console.error('TA Metrics dashboard load failed:', e);
    el('status').textContent = 'Data unavailable';
    el('verifyMeta').textContent = 'Could not reach /api/dashboard';
    el('donationsSub').textContent = 'Open /api/dashboard directly to diagnose';
    document.body.classList.add('error');
  }
}

document.querySelectorAll('.period-btn').forEach((btn) => btn.addEventListener('click', () => {
  RANGE = btn.dataset.range;
  document.querySelectorAll('.period-btn').forEach((b) => b.classList.toggle('active', b === btn));
  renderRange();
}));

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
