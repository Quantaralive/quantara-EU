/* Quantara — AI Betting Diary
 * Frontend-only (GitHub Pages). Offline-first with localStorage, sync to Supabase (if signed in).
 * Tools: Risk/Kelly, Poisson (football), Masaniello (practical heuristic) with Save/Load + steps table.
 * Version: 14
 */
const APP_VERSION = 14;

// ---- Supabase ----
const SUPABASE_URL = "https://bycktplwlfrdjxghajkg.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5Y2t0cGx3bGZyZGp4Z2hhamtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUxNjM0MjEsImV4cCI6MjA3MDczOTQyMX0.ovDq1RLEEuOrTNeSek6-lvclXWmJfOz9DoHOv_L71iw";

const { createClient } = window.supabase;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---- State / Storage ----
const lsKey = "quantara_state_v1";
const defaultState = {
  user: null, // {id, email}
  activeBankrollId: null,
  bankrolls: [], // {id, name, currency, starting_balance, current_balance, supabase_id?}
  bets: [], // {id, bankroll_id, date, sport, league, market, selection, odds, stake, result, profit, notes, supabase_id?}
  masaniello: [], // saved systems
  meta: { createdAt: Date.now(), appVersion: APP_VERSION }
};

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(lsKey);
    if (!raw) return structuredClone(defaultState);
    const obj = JSON.parse(raw);
    return Object.assign(structuredClone(defaultState), obj);
  } catch (e) {
    console.warn("State load error, resetting:", e);
    return structuredClone(defaultState);
  }
}
function saveState() {
  localStorage.setItem(lsKey, JSON.stringify(state));
  refreshUI();
}

// ---- Utilities ----
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const fmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = new Intl.NumberFormat(undefined, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });

function uid() {
  return "id_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0,10);
}
function parseNum(v, def=0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function sum(arr, sel = x => x) {
  return arr.reduce((a, b) => a + sel(b), 0);
}
function byMonthKey(dStr) {
  const d = new Date(dStr + "T00:00:00");
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function assertActiveBankroll() {
  if (!state.activeBankrollId) throw new Error("No active bankroll selected.");
  const br = state.bankrolls.find(b => b.id === state.activeBankrollId);
  if (!br) throw new Error("Active bankroll not found.");
  return br;
}
function calcProfit(odds, stake, result) {
  if (result === 'win') return (odds - 1) * stake;
  if (result === 'lose') return -stake;
  if (result === 'void') return 0;
  return 0;
}

// ---- Tabs ----
const views = $$('.view');
const tabs = $$('.tab');
tabs.forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
function showTab(id) {
  views.forEach(v => v.classList.toggle('active', v.id === id));
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === id));
}

// ---- Account/Auth ----
const btnOpenAuth = $('#btnOpenAuth');
const btnLogout = $('#btnLogout');
const authModal = $('#authModal');
const authEmail = $('#authEmail');
const btnSendMagicLink = $('#btnSendMagicLink');
const btnAnon = $('#btnAnon');
const accountBox = $('#accountBox');

btnOpenAuth.addEventListener('click', () => authModal.showModal());
btnLogout.addEventListener('click', async () => {
  await supabase.auth.signOut();
  state.user = null;
  saveState();
  notify("Signed out.");
});

btnSendMagicLink.addEventListener('click', async () => {
  const email = authEmail.value.trim();
  if (!email) return notify("Enter a valid email.", "warn");
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href } });
  if (error) return notify("Auth error: " + error.message, "danger");
  $('#authHelp').textContent = "Check your email for the magic link. After clicking it, come back here.";
});

btnAnon.addEventListener('click', async () => {
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) return notify("Anon auth error: " + error.message, "danger");
  authModal.close();
  handleAuthChange();
  notify("Anonymous session started.");
});

supabase.auth.onAuthStateChange((ev, session) => {
  if (ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION' || ev === 'SIGNED_OUT') {
    handleAuthChange(session);
  }
});
async function handleAuthChange(session = null) {
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (user) {
    state.user = { id: user.id, email: user.email ?? "anonymous" };
    btnOpenAuth.classList.add('hidden');
    btnLogout.classList.remove('hidden');
    $('#accountBox').textContent = `Signed in as ${state.user.email} (${state.user.id.slice(0,8)}…)`;
    authModal.close();
    // lazy sync
    await ensureProfile();
    await syncFromSupabase();
  } else {
    btnOpenAuth.classList.remove('hidden');
    btnLogout.classList.add('hidden');
    $('#accountBox').textContent = "Not signed in.";
  }
  saveState(); // triggers UI refresh
}
async function ensureProfile() {
  try {
    if (!state.user) return;
    // Upsert profile (ignores errors silently if table missing/RLS not set)
    await supabase.from('profiles').upsert({ id: state.user.id, email: state.user.email });
  } catch (_) {}
}

// ---- Schema help dialog ----
$('#btnSchemaHelp').addEventListener('click', () => $('#schemaModal').showModal());

// ---- Notifications ----
function notify(msg, type='') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  Object.assign(el.style, {
    position:'fixed', right:'16px', bottom:'16px', background:'#0b1119', color:'white',
    border:'1px solid var(--border)', padding:'10px 12px', borderRadius:'10px', zIndex:1000, boxShadow:'var(--shadow)'
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

// ---- Bankrolls ----
const bankrollList = $('#bankrollList');
const btnAddBankroll = $('#btnAddBankroll');
const btnSwitchBankroll = $('#btnSwitchBankroll');
const activeBankrollTag = $('#activeBankrollTag');

btnAddBankroll.addEventListener('click', async () => {
  const name = prompt("Bankroll name?");
  if (!name) return;
  const starting = parseNum(prompt("Starting balance? (e.g., 5000)"), 0);
  const currency = (prompt("Currency (EUR/USD/GBP)?", "EUR") || "EUR").toUpperCase();
  const br = { id: uid(), name, currency, starting_balance: starting, current_balance: starting };
  state.bankrolls.push(br);
  state.activeBankrollId = br.id;
  saveState();
  await upsertBankroll(br).catch(()=>{});
});
btnSwitchBankroll.addEventListener('click', () => {
  if (state.bankrolls.length === 0) return notify("No bankrolls yet.", "warn");
  const names = state.bankrolls.map((b,i)=>`${i+1}. ${b.name} (${b.currency})`).join('\n');
  const pick = parseInt(prompt("Choose bankroll:\n"+names),10);
  if (!Number.isFinite(pick) || pick<1 || pick>state.bankrolls.length) return;
  state.activeBankrollId = state.bankrolls[pick-1].id;
  saveState();
});

function renderBankrolls() {
  bankrollList.innerHTML = '';
  state.bankrolls.forEach(br => {
    const div = document.createElement('div');
    div.className = 'row';
    div.innerHTML = `
      <div>
        <div class="tag">${br.name}</div>
        <div class="muted">${br.currency}</div>
      </div>
      <div><strong>${fmt.format(br.current_balance)}</strong></div>
    `;
    bankrollList.appendChild(div);
  });
  const active = state.bankrolls.find(b => b.id === state.activeBankrollId);
  activeBankrollTag.textContent = active ? `Active: ${active.name}` : "No bankroll";
}

// ---- Bets: add / render / edit ----
const quickBetForm = $('#quickBetForm');
const homeOpenBets = $('#homeOpenBets');
const betsTable = $('#betsTable');
const editBetModal = $('#editBetModal');
const btnDeleteBet = $('#btnDeleteBet');

quickBetForm.date.value = todayStr();

quickBetForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const br = assertActiveBankroll();
    const f = new FormData(quickBetForm);
    const bet = {
      id: uid(),
      bankroll_id: br.id,
      date: f.get('date'),
      sport: f.get('sport') || '',
      league: '',
      market: f.get('market') || '',
      selection: f.get('selection') || '',
      odds: parseNum(f.get('odds')),
      stake: parseNum(f.get('stake')),
      result: f.get('result'),
      profit: 0,
      notes: f.get('notes') || ''
    };
    bet.profit = calcProfit(bet.odds, bet.stake, bet.result);
    state.bets.push(bet);

    // update bankroll balance if not open
    if (bet.result !== 'open') {
      br.current_balance += bet.profit;
    }
    saveState();
    await upsertBet(bet).catch(()=>{});
    notify("Bet added.");
    quickBetForm.reset();
    quickBetForm.date.value = todayStr();
  } catch (err) {
    notify(err.message, 'warn');
  }
});

function renderHomeOpen() {
  const brId = state.activeBankrollId;
  const rows = state.bets.filter(b => b.bankroll_id === brId && (b.result === 'open' || b.date === todayStr()));
  homeOpenBets.innerHTML = tableHTML(rows, true);
}
function renderBetsTable() {
  const from = $('#filterDateFrom').value || '1900-01-01';
  const to = $('#filterDateTo').value || '2999-12-31';
  const filt = $('#filterResult').value || 'all';
  const brId = state.activeBankrollId;
  const rows = state.bets.filter(b => b.bankroll_id === brId)
    .filter(b => (b.date >= from && b.date <= to))
    .filter(b => (filt==='all' ? true : b.result === filt))
    .sort((a,b)=>a.date.localeCompare(b.date));

  betsTable.innerHTML = tableHTML(rows, true);
}

function tableHTML(rows, withActions=false){
  let html = `<table><thead><tr>
    <th>Date</th><th>Sport</th><th>Market</th><th>Selection</th>
    <th>Odds</th><th>Stake</th><th>Result</th><th>Profit</th>${withActions?'<th></th>':''}
  </tr></thead><tbody>`;
  if (rows.length === 0) {
    html += `<tr><td colspan="9" class="muted">No rows.</td></tr>`;
  } else {
    html += rows.map(r=>`<tr data-id="${r.id}">
      <td>${r.date}</td>
      <td>${escapeHtml(r.sport)}</td>
      <td>${escapeHtml(r.market)}</td>
      <td>${escapeHtml(r.selection)}</td>
      <td>${Number(r.odds).toFixed(2)}</td>
      <td>${fmt.format(r.stake)}</td>
      <td><span class="pill ${r.result}">${r.result}</span></td>
      <td>${fmt.format(r.profit)}</td>
      ${withActions?'<td><button class="btn ghost btnEdit" data-id="'+r.id+'">Edit</button></td>':''}
    </tr>`).join('');
  }
  html += `</tbody></table>`;
  return html;
}
function escapeHtml(s){return (s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}

betsTable.addEventListener('click', onEditBtn);
homeOpenBets.addEventListener('click', onEditBtn);

function onEditBtn(e){
  const btn = e.target.closest('.btnEdit');
  if (!btn) return;
  const id = btn.dataset.id;
  const bet = state.bets.find(b => b.id === id);
  if (!bet) return;
  const form = editBetModal.querySelector('form');
  form.id.value = bet.id;
  form.date.value = bet.date;
  form.sport.value = bet.sport;
  form.market.value = bet.market;
  form.selection.value = bet.selection;
  form.odds.value = bet.odds;
  form.stake.value = bet.stake;
  form.result.value = bet.result;
  form.notes.value = bet.notes || '';
  editBetModal.showModal();
}

editBetModal.addEventListener('close', () => {
  if (editBetModal.returnValue !== 'default') return; // cancelled
  const form = editBetModal.querySelector('form');
  const id = form.id.value;
  const bet = state.bets.find(b => b.id === id);
  if (!bet) return;
  const oldProfit = bet.profit;
  const br = state.bankrolls.find(x => x.id === bet.bankroll_id);

  bet.date = form.date.value;
  bet.sport = form.sport.value;
  bet.market = form.market.value;
  bet.selection = form.selection.value;
  bet.odds = parseNum(form.odds.value);
  bet.stake = parseNum(form.stake.value);
  bet.result = form.result.value;
  bet.notes = form.notes.value;
  bet.profit = calcProfit(bet.odds, bet.stake, bet.result);

  // adjust bankroll delta when closing win/lose/void vs previous
  if (br) {
    br.current_balance += (bet.profit - oldProfit);
  }
  saveState();
  upsertBet(bet).catch(()=>{});
  notify("Bet updated.");
});

btnDeleteBet.addEventListener('click', async () => {
  const form = editBetModal.querySelector('form');
  const id = form.id.value;
  const idx = state.bets.findIndex(b => b.id === id);
  if (idx === -1) return;
  const bet = state.bets[idx];
  const br = state.bankrolls.find(x => x.id === bet.bankroll_id);
  if (br) br.current_balance -= bet.profit; // rollback
  state.bets.splice(idx,1);
  saveState();
  await deleteBet(bet).catch(()=>{});
  editBetModal.close();
  notify("Bet deleted.", "danger");
});

// Filters
$('#btnApplyFilter').addEventListener('click', renderBetsTable);

// ---- Analytics / Charts ----
let charts = {};
function ensureChart(id, cfg){
  const ctx = document.getElementById(id);
  if (!ctx) return null;
  if (charts[id]) { charts[id].destroy(); }
  charts[id] = new Chart(ctx, cfg);
  return charts[id];
}

function computeMonthlyPnL(brId){
  const rows = state.bets.filter(b => b.bankroll_id === brId && b.result !== 'open');
  const group = {};
  rows.forEach(b => {
    const k = byMonthKey(b.date);
    group[k] = (group[k] || 0) + b.profit;
  });
  const keys = Object.keys(group).sort();
  return { labels: keys, values: keys.map(k => group[k]) };
}
function computeEquitySeries(brId){
  const br = state.bankrolls.find(b => b.id === brId);
  if (!br) return { labels:[], values:[] };
  const rows = state.bets.filter(b => b.bankroll_id === brId).sort((a,b)=>a.date.localeCompare(b.date));
  let bal = br.starting_balance;
  const labels = [];
  const values = [];
  rows.forEach(b => {
    if (b.result !== 'open') bal += b.profit;
    labels.push(b.date);
    values.push(bal);
  });
  return { labels, values };
}
function computeROIByBankroll(){
  return state.bankrolls.map(br => {
    const rows = state.bets.filter(b => b.bankroll_id === br.id && b.result !== 'open');
    const staked = sum(rows, r => r.stake);
    const profit = sum(rows, r => r.profit);
    const roi = staked>0 ? (profit / staked) : 0;
    return { name: br.name, roi, staked, profit, currency: br.currency };
  });
}
function renderCharts(){
  const brId = state.activeBankrollId;
  // Home snapshot
  const eq = computeEquitySeries(brId);
  ensureChart('homeSnapshotChart', {
    type:'line',
    data:{ labels:eq.labels, datasets:[{ label:'Equity', data:eq.values }]},
    options:{ responsive:true, plugins:{legend:{display:false}}, scales:{x:{display:false}} }
  });
  // Monthly PnL
  const mp = computeMonthlyPnL(brId);
  ensureChart('monthlyPnLChart', {
    type:'bar',
    data:{ labels: mp.labels, datasets:[{ label:'P&L', data: mp.values }]},
    options:{ responsive:true, plugins:{legend:{display:false}} }
  });
  // Equity
  ensureChart('equityChart', {
    type:'line',
    data:{ labels: eq.labels, datasets:[{ label:'Equity', data:eq.values }]},
    options:{ responsive:true, plugins:{legend:{display:false}} }
  });
  // ROI by bankroll
  const roi = computeROIByBankroll();
  ensureChart('roiByBankrollChart', {
    type:'bar',
    data:{
      labels: roi.map(r=>r.name),
      datasets:[{ label:'ROI', data: roi.map(r=> (r.roi*100).toFixed(2)) }]
    },
    options:{ scales:{ y:{ ticks:{ callback:(v)=>v+'%' }}}}
  });
  // KPIs
  renderKPIs();
}
function renderKPIs(){
  const brId = state.activeBankrollId;
  const rows = state.bets.filter(b => b.bankroll_id === brId && b.result !== 'open');
  const staked = sum(rows, r=>r.stake);
  const profit = sum(rows, r=>r.profit);
  const n = rows.length;
  const wins = rows.filter(r=>r.result==='win').length;
  const wr = n>0 ? wins/n : 0;
  $('#kpiGrid').innerHTML = `
  <div class="kpi"><div class="label">Total Staked</div><div class="value">${fmt.format(staked)}</div></div>
  <div class="kpi"><div class="label">Net Profit</div><div class="value">${fmt.format(profit)}</div></div>
  <div class="kpi"><div class="label">Bets Closed</div><div class="value">${n}</div></div>
  <div class="kpi"><div class="label">Win Rate</div><div class="value">${fmtPct.format(wr)}</div></div>
  `;
}

// ---- Calendar ----
let calMonth = new Date();
function renderCalendar(){
  const title = $('#calTitle');
  title.textContent = calMonth.toLocaleString(undefined, { month:'long', year:'numeric' });
  const first = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1);
  const startDay = new Date(first);
  startDay.setDate(first.getDate() - ((first.getDay()+6)%7)); // Monday start
  const days = [];
  for (let i=0;i<42;i++){
    const d = new Date(startDay);
    d.setDate(startDay.getDate()+i);
    days.push(d);
  }
  const brId = state.activeBankrollId;
  const rows = state.bets.filter(b=>b.bankroll_id===brId);
  const grid = $('#calendarGrid');
  grid.innerHTML = '';
  days.forEach(d => {
    const ds = d.toISOString().slice(0,10);
    const onDay = rows.filter(b=>b.date===ds);
    const pnl = sum(onDay, b=>b.result==='open'?0:b.profit);
    const el = document.createElement('div');
    el.className = 'day';
    el.innerHTML = `
      <div class="head"><span>${d.getDate()}</span><span class="muted">${onDay.length} bets</span></div>
      ${onDay.slice(0,3).map(b=>`<div class="pill ${b.result}">${b.market||b.selection||b.sport}</div>`).join('')}
      ${onDay.length>3 ? `<div class="muted" style="margin-top:4px;">+${onDay.length-3} more</div>`:''}
      <div class="muted" style="margin-top:8px;">PnL: ${fmt.format(pnl)}</div>
    `;
    grid.appendChild(el);
  });
}
$('#calPrev').addEventListener('click', ()=>{ calMonth.setMonth(calMonth.getMonth()-1); renderCalendar(); });
$('#calNext').addEventListener('click', ()=>{ calMonth.setMonth(calMonth.getMonth()+1); renderCalendar(); });

// ---- Tools: Risk/Kelly ----
const riskForm = $('#riskForm');
const riskOutput = $('#riskOutput');
let riskChart;
$('#riskUseBankroll').addEventListener('click', ()=>{
  try {
    const br = assertActiveBankroll();
    riskForm.bankroll.value = String(br.current_balance);
  } catch(e){ notify(e.message,'warn'); }
});
riskForm.addEventListener('submit', (e)=>{
  e.preventDefault();
  const br = parseNum(riskForm.bankroll.value);
  const odds = parseNum(riskForm.odds.value);
  const p = parseNum(riskForm.p.value);
  const b = odds - 1;
  const k = Math.max(0, ((b * p) - (1 - p)) / b); // Kelly fraction of bankroll
  const stakeKelly = br * k;
  const stakeHalf = br * (k/2);
  riskOutput.innerHTML = `
    <div>Edge: ${(p*odds - 1 > 0) ? 'Positive' : 'Negative'}</div>
    <div>Kelly fraction: ${fmtPct.format(k)}</div>
    <div>Stake (Kelly): <strong>${fmt.format(stakeKelly)}</strong></div>
    <div>Stake (½ Kelly): <strong>${fmt.format(stakeHalf)}</strong></div>
  `;
  if (riskChart) riskChart.destroy();
  riskChart = new Chart($('#riskChart'), {
    type:'bar',
    data:{ labels:['Kelly','Half-Kelly'], datasets:[{ label:'Stake', data:[stakeKelly, stakeHalf] }]},
    options:{ plugins:{legend:{display:false}} }
  });
});

// ---- Tools: Poisson (football) ----
const poissonForm = $('#poissonForm');
const poissonOutput = $('#poissonOutput');
let poissonChart;
poissonForm.addEventListener('submit',(e)=>{
  e.preventDefault();
  const lH = parseNum(poissonForm.lambdaHome.value);
  const lA = parseNum(poissonForm.lambdaAway.value);
  const maxGoals = 6;

  const pd = (lambda,k) => (Math.exp(-lambda) * Math.pow(lambda,k)) / fact(k);
  function fact(n){ let r=1; for(let i=2;i<=n;i++) r*=i; return r; }

  const distH = Array.from({length:maxGoals+1}, (_,k)=>pd(lH,k));
  const distA = Array.from({length:maxGoals+1}, (_,k)=>pd(lA,k));

  // Outcome probabilities
  let pHome=0, pDraw=0, pAway=0, pBTTS=0, pO25=0;
  for (let i=0;i<=maxGoals;i++){
    for (let j=0;j<=maxGoals;j++){
      const p = distH[i]*distA[j];
      if (i>j) pHome+=p; else if (i===j) pDraw+=p; else pAway+=p;
      if (i>0 && j>0) pBTTS+=p;
      if ((i+j)>2) pO25+=p;
    }
  }
  poissonOutput.innerHTML = `
    <div>Home: ${fmtPct.format(pHome)} | Draw: ${fmtPct.format(pDraw)} | Away: ${fmtPct.format(pAway)}</div>
    <div>BTTS: ${fmtPct.format(pBTTS)} | Over 2.5: ${fmtPct.format(pO25)}</div>
  `;
  if (poissonChart) poissonChart.destroy();
  poissonChart = new Chart($('#poissonChart'), {
    type:'bar',
    data:{ labels: distH.map((_,i)=>String(i)+" goals"),
      datasets:[
        { label:'Home', data: distH.map(x=>x*100) },
        { label:'Away', data: distA.map(x=>x*100) }
      ]},
    options:{ scales:{ y:{ ticks:{ callback:v=>v+'%' }}}}
  });
});

// ---- Tools: Masaniello (heuristic engine) ----
const masForm = $('#masForm');
const masTable = $('#masTable');
const masSavedList = $('#masSavedList');
$('#btnSaveMasaniello').addEventListener('click', saveMasSystem);
$('#btnLoadMasaniello').addEventListener('click', loadMasSystemPrompt);

masForm.addEventListener('submit',(e)=>{
  e.preventDefault();
  const f = new FormData(masForm);
  const sys = {
    id: uid(),
    name: f.get('name') || `System ${new Date().toLocaleString()}`,
    n: parseInt(f.get('n'),10),
    k: parseInt(f.get('k'),10),
    target: parseNum(f.get('target')),
    bankroll: parseNum(f.get('bankroll')),
    avgOdds: parseNum(f.get('avgOdds')),
    steps: []
  };
  if (sys.k > sys.n) { notify("K cannot exceed N","warn"); return; }
  sys.steps = buildMasaniello(sys);
  renderMasaniello(sys);
  masTable.dataset.currentId = sys.id;
  // keep it in memory (not saved yet)
  window._currentMas = sys;
});

// practical Masaniello heuristic (keeps stake adaptive to reach target with expected wins)
function buildMasaniello(sys){
  const steps = [];
  let remainingWins = sys.k;
  let remainingBets = sys.n;
  let bankroll = sys.bankroll;
  for (let i=0;i<sys.n;i++){
    const avgOdds = sys.avgOdds;
    const b = (avgOdds - 1);
    // needed average win profit to reach target across remainingWins
    const remainingTarget = Math.max(0, sys.target - Math.max(0, bankroll - sys.bankroll));
    const unit = remainingWins > 0 ? (remainingTarget / remainingWins) : 0;
    // stake to win "unit" at avg odds
    let stake = b>0 ? unit / b : 0;
    // guardrails
    const maxStake = bankroll * 0.2; // cap per bet 20% to avoid blowups
    if (stake > maxStake) stake = maxStake;
    steps.push({
      idx: i+1,
      odds: '', // user can fill real odds later
      plannedStake: round2(stake),
      result: 'pending',
      actualStake: round2(stake),
      profit: 0
    });
    remainingBets -= 1;
  }
  return steps;
}
function round2(x){ return Math.round((x + Number.EPSILON) * 100) / 100; }

function renderMasaniello(sys){
  const rows = sys.steps.map(s=>`
    <tr data-idx="${s.idx}">
      <td>${s.idx}</td>
      <td><input type="number" class="inOdds" step="0.0001" min="1.01" value="${s.odds}"></td>
      <td><input type="number" class="inStake" step="0.01" min="0" value="${s.actualStake}"></td>
      <td>
        <select class="inResult">
          <option value="pending" ${s.result==='pending'?'selected':''}>Pending</option>
          <option value="win" ${s.result==='win'?'selected':''}>Win</option>
          <option value="lose" ${s.result==='lose'?'selected':''}>Lose</option>
          <option value="void" ${s.result==='void'?'selected':''}>Void</option>
        </select>
      </td>
      <td class="cellProfit">${fmt.format(s.profit)}</td>
    </tr>
  `).join('');

  masTable.innerHTML = `
    <table>
      <thead><tr><th>#</th><th>Odds</th><th>Stake</th><th>Result</th><th>Profit</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="row end" style="margin-top:8px;">
      <button class="btn" id="btnMasRecalc">Recalculate Next</button>
    </div>
  `;

  $('#btnMasRecalc').addEventListener('click', ()=>{
    const cur = window._currentMas;
    applyMasanielloInputs(cur);
    recalcMasaniello(cur);
    renderMasaniello(cur);
  });

  masTable.addEventListener('change', (e)=>{
    if (!window._currentMas) return;
    applyMasanielloInputs(window._currentMas);
  });

  renderSavedMasList();
}
function applyMasanielloInputs(sys){
  const rows = masTable.querySelectorAll('tbody tr');
  rows.forEach(tr=>{
    const idx = parseInt(tr.dataset.idx,10);
    const s = sys.steps[idx-1];
    s.odds = tr.querySelector('.inOdds').value;
    s.actualStake = parseNum(tr.querySelector('.inStake').value);
    s.result = tr.querySelector('.inResult').value;
    const odds = parseNum(s.odds);
    s.profit = (s.result==='win') ? round2((odds - 1) * s.actualStake) :
               (s.result==='lose') ? round2(-s.actualStake) : 0;
    tr.querySelector('.cellProfit').textContent = fmt.format(s.profit);
  });
}
function recalcMasaniello(sys){
  // Recompute next stake based on achieved profit vs target
  const achieved = sum(sys.steps.filter(s=>s.result!=='pending'), s=>s.profit);
  const winsSoFar = sys.steps.filter(s=>s.result==='win').length;
  const remainingWins = Math.max(0, sys.k - winsSoFar);
  const remaining = sys.steps.filter(s=>s.result==='pending').length;
  const remainingTarget = Math.max(0, sys.target - achieved);
  const b = sys.avgOdds - 1;
  const nextStake = (remainingWins>0 && b>0) ? round2((remainingTarget / remainingWins) / b) : 0;

  // apply next planned stake to the first pending row
  const firstPending = sys.steps.find(s=>s.result==='pending');
  if (firstPending) {
    firstPending.plannedStake = nextStake;
    if (!firstPending.actualStake || firstPending.actualStake===0) {
      firstPending.actualStake = nextStake;
    }
  }
}

async function saveMasSystem(){
  if (!window._currentMas) { notify("Build a system first.","warn"); return; }
  const sys = window._currentMas;
  // persist locally
  const idx = state.masaniello.findIndex(x => x.id === sys.id);
  if (idx === -1) state.masaniello.push(sys); else state.masaniello[idx] = sys;
  saveState();
  notify("Masaniello saved.");

  // persist to Supabase (best-effort)
  try {
    if (state.user) {
      const brId = state.activeBankrollId || null;
      await supabase.from('masaniello_systems').upsert({
        id: sys.id,
        user_id: state.user.id,
        bankroll_id: brId,
        name: sys.name,
        n_bets: sys.n,
        expected_wins: sys.k,
        target_profit: sys.target,
        starting_bankroll: sys.bankroll,
        avg_odds: sys.avgOdds,
        state: sys
      });
    }
  } catch (_) {}
  renderSavedMasList();
}
function renderSavedMasList(){
  masSavedList.innerHTML = '';
  state.masaniello.forEach(s=>{
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
      <div><div class="tag">${escapeHtml(s.name)}</div>
      <div class="muted">${s.n} bets, K=${s.k}, target ${fmt.format(s.target)}</div></div>
      <div>
        <button class="btn ghost" data-id="${s.id}" data-act="load">Load</button>
        <button class="btn danger" data-id="${s.id}" data-act="del">Delete</button>
      </div>
    `;
    masSavedList.appendChild(row);
  });
  masSavedList.addEventListener('click', (e)=>{
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.act;
    const sys = state.masaniello.find(x=>x.id===id);
    if (!sys) return;
    if (act==='load'){
      window._currentMas = sys;
      renderMasaniello(sys);
      showTab('tools');
    } else if (act==='del'){
      const i = state.masaniello.findIndex(x=>x.id===id);
      state.masaniello.splice(i,1); saveState(); renderSavedMasList();
    }
  }, { once: true });
}
function loadMasSystemPrompt(){
  if (state.masaniello.length === 0) return notify("No saved systems yet.","warn");
  const names = state.masaniello.map((s,i)=>`${i+1}. ${s.name} (${s.n} bets)`).join('\n');
  const pick = parseInt(prompt("Load which system?\n"+names),10);
  if (!Number.isFinite(pick) || pick<1 || pick>state.masaniello.length) return;
  window._currentMas = state.masaniello[pick-1];
  renderMasaniello(window._currentMas);
}

// ---- Supabase Sync (best-effort, silent on failure) ----
async function syncFromSupabase(){
  if (!state.user) return;
  try {
    // bankrolls
    const { data: brs } = await supabase.from('bankrolls').select('*').order('created_at', { ascending: true });
    if (Array.isArray(brs)) {
      brs.forEach(br => {
        const local = state.bankrolls.find(x => x.id === br.id);
        if (!local) state.bankrolls.push({
          id: br.id, name: br.name, currency: br.currency,
          starting_balance: Number(br.starting_balance), current_balance: Number(br.current_balance), supabase_id: br.id
        });
      });
      if (!state.activeBankrollId && brs[0]) state.activeBankrollId = brs[0].id;
    }
    // bets
    const { data: bets } = await supabase.from('bets').select('*').order('date', { ascending: true });
    if (Array.isArray(bets)) {
      bets.forEach(b => {
        if (!state.bets.find(x => x.id === b.id)) {
          state.bets.push({
            id: b.id, bankroll_id: b.bankroll_id, date: b.date,
            sport: b.sport||'', league: b.league||'', market: b.market||'', selection: b.selection||'',
            odds: Number(b.odds), stake: Number(b.stake), result: b.result, profit: Number(b.profit||0), notes: b.notes||'',
            supabase_id: b.id
          });
        }
      });
    }
    // masaniello
    const { data: mass } = await supabase.from('masaniello_systems').select('*').order('created_at', { ascending: true });
    if (Array.isArray(mass)) {
      mass.forEach(m => {
        const local = state.masaniello.find(x => x.id === m.id);
        const sys = (m.state && typeof m.state === 'object') ? m.state : {
          id:m.id, name:m.name, n:m.n_bets, k:m.expected_wins, target:Number(m.target_profit),
          bankroll:Number(m.starting_bankroll), avgOdds:Number(m.avg_odds), steps:[]
        };
        if (!local) state.masaniello.push(sys);
      });
    }
    saveState();
  } catch (e) {
    console.warn("Supabase sync error:", e);
  }
}

async function upsertBankroll(br){
  if (!state.user) return;
  await supabase.from('bankrolls').upsert({
    id: br.id, user_id: state.user.id, name: br.name, currency: br.currency,
    starting_balance: br.starting_balance, current_balance: br.current_balance
  });
}
async function upsertBet(bet){
  if (!state.user) return;
  await supabase.from('bets').upsert({
    id: bet.id, user_id: state.user.id, bankroll_id: bet.bankroll_id, date: bet.date, sport: bet.sport,
    league: bet.league, market: bet.market, selection: bet.selection, odds: bet.odds, stake: bet.stake,
    result: bet.result, profit: bet.profit, notes: bet.notes
  });
}
async function deleteBet(bet){
  if (!state.user) return;
  await supabase.from('bets').delete().eq('id', bet.id);
}

// ---- Initial Render / UI refresh ----
function refreshUI(){
  renderBankrolls();
  renderHomeOpen();
  renderBetsTable();
  renderCharts();
  renderCalendar();
  renderSavedMasList();
  $('#appVersion').textContent = String(APP_VERSION);
}
document.addEventListener('DOMContentLoaded', async () => {
  // if returning from magic link
  await handleAuthChange();
  refreshUI();
});

// ---- Expose small helpers for console debugging ----
window.Q = { state, saveState, refreshUI };
