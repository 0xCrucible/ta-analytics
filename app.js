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

    const amounts = Array.isArray(state.donations) ? state.donations : [];
    const allSame = amounts.length > 1 && amounts.every((x) => +x.amount === +amounts[0].amount);
    const individual = allSame
      ? `${money(amounts[0].amount)} × ${amounts.length}`
      : amounts.map((x) => money(x.amount)).join(' · ');

    card.innerHTML = `
      <div class="state-card__top">
        <div class="state-abbr">${state.abbr || ''}</div>
        <div class="state-total">${money(state.total)}</div>
      </div>
      <h3>${state.state}</h3>
      <div class="state-count">${state.count} contribution${state.count === 1 ? '' : 's'}</div>
      <div class="state-individual-label">Individual donations</div>
      <div class="state-individual">${individual || '—'}</div>
      <div class="state-dates">${amounts.slice(0, 4).map((x) => x.dateLabel).filter(Boolean).join(' · ')}${amounts.length > 4 ? ` · +${amounts.length - 4} more` : ''}</div>
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
  el('holderPeriod').textContent = meta.label;
  el('chartTitle').textContent = meta.title;

  el('volume').textContent = money(r.volume, true);
  el('volumeSub').textContent = r.volumeAvailable
    ? `${DATA.marketPairs || 0} tracked TA market pair${DATA.marketPairs === 1 ? '' : 's'} · public DEX data`
    : (r.volumeNote || 'Historical market volume not available yet');

  el('treasuryAdded').textContent = money(r.treasuryAdded);
  el('treasuryAddedSub').textContent = r.treasuryAddedNote || 'Actual inbound treasury transfers in this period';

  el('donations').textContent = money(r.donations);
  el('donationsSub').textContent = `${r.donationCount || 0} published donation${r.donationCount === 1 ? '' : 's'} in this period`;

  el('newHolders').textContent = integer(r.newHolders);
  el('newHoldersSub').textContent = r.newHoldersNote || 'New wallets holding TA in this period';

  el('chartNote').textContent = `Published donation activity · ${meta.title.toLowerCase()}.`;
  draw(r.series || []);
}

function render(d) {
  DATA = d;
  el('heroContributions').textContent = money(d.totalContributed);
  el('allTimeDonations').textContent = money(d.totalContributed);
  el('treasury').textContent = money(d.treasury);
  el('treasuryCard').textContent = money(d.treasury);
  el('accountsFunded').textContent = integer(d.accountsFunded);
  el('accountsFundedHero').textContent = integer(d.accountsFunded);
  el('totalHolders').textContent = integer(d.totalHolders);
  el('totalHoldersHero').textContent = integer(d.totalHolders);
  el('holdersNow').textContent = integer(d.totalHolders);
  el('holdersNowSub').textContent = d.holdersAvailable ? 'Current holder count from public explorer data' : 'Holder count source unavailable right now';
  el('marketPairs').textContent = integer(d.marketPairs);
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
