// ===============================
// QUANTARA — AI Betting Diary
// Frontend: GitHub Pages (static)
// Auth/DB: Supabase (anon key)
// Charts: Chart.js v4
// Version: v15
// ===============================

// ---- Supabase setup (public anon key is OK for browser apps)
const SUPABASE_URL = "https://bycktplwlfrdjxghajkg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5Y2t0cGx3bGZyZGp4Z2hhamtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUxNjM0MjEsImV4cCI6MjA3MDczOTQyMX0.ovDq1RLEEuOrTNeSek6-lvclXWmJfOz9DoHOv_L71iw";

// Supabase v2
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true } });

// ---- DOM helpers
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const fmtEur = (n) => `€${(Number(n)||0).toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:2})}`;
const fmtPct = (n) => `${(Number(n)||0).toFixed(1)}%`;
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));

// ---- App state
const State = {
  user: null,
  activeTab: "home",
  activeBankrollId: localStorage.getItem("quantara_active_bankroll_id") || null,
  charts: {},           // Chart.js instances
  bets: [],             // cached bets for active bankroll
  bankrolls: [],        // cached bankrolls
  calendar: { year: new Date().getFullYear(), month: new Date().getMonth() }, // 0..11
};

// Expose simple router for tab buttons used inline in HTML
window.__go = (t) => switchTab(t);

// ---- Boot
console.log("Quantara boot v15");
document.addEventListener("DOMContentLoaded", init);

async function init(){
  wireAuthUI();
  wireOverviewUI();
  wireLedgerUI();
  wireEditModal();
  wireBankrollModal();
  wireCalendarUI();
  wireToolsUI();

  await refreshAuth(); // sets State.user
  switchTab(State.activeTab || "home");
}

// ===============================
// Auth
// ===============================
function wireAuthUI(){
  $("#signup").addEventListener("click", async () => {
    const email = $("#email").value.trim();
    const password = $("#password").value;
    if(!email || !password) return alert("Email + password required.");
    const { error } = await supabase.auth.signUp({ email, password });
    if(error) return alert(error.message);
    alert("Check your inbox to confirm your email.");
  });

  $("#signin").addEventListener("click", async () => {
    const email = $("#email").value.trim();
    const password = $("#password").value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if(error) return alert(error.message);
  });

  $("#send-link").addEventListener("click", async () => {
    const email = $("#email").value.trim();
    if(!email) return alert("Enter your email.");
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href }});
    if(error) return alert(error.message);
    alert("Magic link sent.");
  });

  $("#signout").addEventListener("click", async () => {
    await supabase.auth.signOut();
  });

  supabase.auth.onAuthStateChange(async (_evt, session) => {
    State.user = session?.user || null;
    $("#signout").style.display = State.user ? "" : "none";
    await loadEverything();
  });
}

async function refreshAuth(){
  const { data } = await supabase.auth.getSession();
  State.user = data.session?.user || null;
  $("#signout").style.display = State.user ? "" : "none";
}

// ===============================
// Router
// ===============================
function switchTab(tab){
  State.activeTab = tab;
  // toggle tab button active class
  $$(".tabs .tab").forEach(btn => btn.classList.remove("active"));
  $(`#tab-btn-${tab}`)?.classList.add("active");

  // toggle panels
  ["home","overview","analytics","roi","calendar","tools"].forEach(id=>{
    const el = $(`#tab-${id}`);
    if(el) el.classList.toggle("hidden", id !== tab);
  });

  // lazy loads
  if(tab === "home") renderHome();
  if(tab === "overview") renderOverview();
  if(tab === "analytics") renderAnalytics();
  if(tab === "roi") renderROI();
  if(tab === "calendar") renderCalendar();
  if(tab === "tools") renderToolsLanding();
}

// ===============================
// Load everything after login or on boot
// ===============================
async function loadEverything(){
  await loadBankrolls();
  if(State.activeBankrollId && !State.bankrolls.find(b=>b.id===State.activeBankrollId)){
    // active id vanished
    State.activeBankrollId = null;
    localStorage.removeItem("quantara_active_bankroll_id");
  }
  await loadBets();
  renderHome();
  renderOverview();
  renderAnalytics();
  renderROI();
  renderCalendar();
}

// ===============================
// Bankrolls
// ===============================
async function loadBankrolls(){
  if(!State.user){
    State.bankrolls = [];
    return;
  }
  const { data, error } = await supabase
    .from("bankrolls")
    .select("*")
    .eq("user_id", State.user.id)
    .order("created_at", { ascending: true });
  if(error){ console.error(error); State.bankrolls = []; return; }
  State.bankrolls = data || [];
}

function renderHome(){
  // Current selection
  const curr = State.bankrolls.find(b=>b.id===State.activeBankrollId);
  $("#current-bk").textContent = curr ? `${curr.name} — ${fmtEur(curr.start_amount || 0)}` : "None selected";

  // Grid
  const wrap = $("#bankroll-grid");
  wrap.innerHTML = "";
  if(!State.user){
    wrap.innerHTML = `<div class="muted">Sign in to create bankrolls.</div>`;
    return;
  }
  if(State.bankrolls.length===0){
    wrap.innerHTML = `<div class="muted">No bankrolls yet. Click “New bankroll”.</div>`;
    return;
  }
  for(const bk of State.bankrolls){
    const div = document.createElement("div");
    div.className = "bankroll-card";
    const totalP = computeProfitForBankroll(bk.id);
    const pClass = totalP>=0 ? "profit-pos" : "profit-neg";
    div.innerHTML = `
      <div class="bankroll-row">
        <div>
          <div class="bankroll-title">${bk.name}</div>
          <div class="bankroll-sub">Start: ${fmtEur(bk.start_amount||0)} · Bets: <span data-bk-count="${bk.id}">—</span></div>
        </div>
        <div class="bk-pill ${pClass}">${fmtEur(totalP)}</div>
      </div>
      <div class="bankroll-actions">
        <button class="btn" data-open="${bk.id}">Open</button>
        <button class="btn btn-ghost" data-rename="${bk.id}">Rename</button>
        <button class="btn btn-ghost" data-delete="${bk.id}">Delete</button>
      </div>
    `;
    wrap.appendChild(div);
  }

  // counts
  const counts = countBetsPerBk();
  Object.entries(counts).forEach(([bkId,count])=>{
    const el = document.querySelector(`[data-bk-count="${bkId}"]`);
    if(el) el.textContent = count;
  });

  // actions
  wrap.querySelectorAll("button[data-open]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      State.activeBankrollId = btn.getAttribute("data-open");
      localStorage.setItem("quantara_active_bankroll_id", State.activeBankrollId);
      switchTab("overview");
    });
  });
  wrap.querySelectorAll("button[data-rename]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.getAttribute("data-rename");
      const bk = State.bankrolls.find(b=>b.id===id);
      const name = prompt("New name", bk?.name || "");
      if(!name) return;
      const { error } = await supabase.from("bankrolls").update({ name }).eq("id", id);
      if(error) return alert(error.message);
      await loadBankrolls(); renderHome();
    });
  });
  wrap.querySelectorAll("button[data-delete]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.getAttribute("data-delete");
      if(!confirm("Delete bankroll and all its bets?")) return;
      await supabase.from("bets").delete().eq("bankroll_id", id);
      await supabase.from("bankrolls").delete().eq("id", id);
      if(State.activeBankrollId===id){
        State.activeBankrollId = null; localStorage.removeItem("quantara_active_bankroll_id");
      }
      await loadBankrolls(); await loadBets(); renderHome();
    });
  });
}

function countBetsPerBk(){
  const map = {};
  for(const b of State.bets) map[b.bankroll_id]=(map[b.bankroll_id]||0)+1;
  return map;
}

window.__openBkModal = ()=>{$("#bk-modal").classList.remove("hidden"); $("#bk-name").value=""; $("#bk-start").value="";};
window.__clearActive = ()=>{ State.activeBankrollId=null; localStorage.removeItem("quantara_active_bankroll_id"); renderHome(); };

function wireBankrollModal(){
  $("#bk-close").addEventListener("click", ()=> $("#bk-modal").classList.add("hidden"));
  $("#bk-cancel").addEventListener("click", ()=> $("#bk-modal").classList.add("hidden"));
  $("#bk-form").addEventListener("submit", async (e)=>{
    e.preventDefault();
    if(!State.user) return alert("Sign in first.");
    const name = $("#bk-name").value.trim();
    const start = Number($("#bk-start").value||0);
    if(!name) return;
    const { error } = await supabase.from("bankrolls").insert({ user_id: State.user.id, name, start_amount: start });
    if(error) return alert(error.message);
    $("#bk-modal").classList.add("hidden");
    await loadBankrolls(); renderHome();
  });
}

// Helper: get active bankroll record
function currentBk(){
  return State.bankrolls.find(b=>b.id===State.activeBankrollId) || null;
}

// ===============================
// Bets
// ===============================
async function loadBets(){
  if(!State.user){
    State.bets = [];
    return;
  }
  // Load for all bankrolls (simplifies counts / analytics)
  const { data, error } = await supabase
    .from("bets")
    .select("*")
    .eq("user_id", State.user.id)
    .order("date", { ascending: true });
  if(error){ console.error(error); State.bets = []; return; }
  State.bets = data || [];
}

function wireLedgerUI(){
  $("#add-form").addEventListener("submit", async (e)=>{
    e.preventDefault();
    if(!State.user) return alert("Sign in first.");
    const bk = currentBk();
    if(!bk) return alert("Select a bankroll in Home.");
    const row = {
      user_id: State.user.id,
      bankroll_id: bk.id,
      date: $("#f-date").value || new Date().toISOString().slice(0,10),
      sport: $("#f-sport").value.trim(),
      league: $("#f-league").value.trim() || null,
      market: $("#f-market").value.trim() || null,
      selection: $("#f-selection").value.trim() || null,
      odds: Number($("#f-odds").value||0),
      stake: Number($("#f-stake").value||0),
      result: $("#f-result").value || "pending",
    };
    const { error } = await supabase.from("bets").insert(row);
    if(error) return alert(error.message);
    // Reset a few fields
    $("#f-selection").value = "";
    await loadBets();
    renderOverview();
    renderAnalytics();
    renderROI();
    renderCalendar();
  });
}

function renderOverview(){
  const bk = currentBk();
  $("#bk-name-inline").textContent = bk?.name || "—";
  $("#bk-name-inline-2").textContent = bk?.name || "—";

  if(!bk){
    $("#bankroll").textContent = "€0";
    $("#staked").textContent = "€0";
    $("#winrate").textContent = "0%";
    $("#bankroll-start").value = "";
    renderBankrollChart([]);
    renderLedger([]); 
    return;
  }
  $("#bankroll-start").value = bk.start_amount || 0;

  const bets = State.bets.filter(b=>b.bankroll_id===bk.id);
  const settled = bets.filter(b=>b.result==="win"||b.result==="loss"||b.result==="void");
  const pnl = settled.reduce((s,b)=> s + profitOf(b), 0);
  const staked = bets.reduce((s,b)=> s + (Number(b.stake)||0), 0);
  const wins = settled.filter(b=>b.result==="win").length;
  const wr = settled.length? (wins/settled.length*100):0;

  $("#bankroll").textContent = fmtEur((bk.start_amount||0)+pnl);
  $("#staked").textContent = fmtEur(staked);
  $("#winrate").textContent = fmtPct(wr);

  // chart data: cumulative bankroll by date
  const points = [];
  let bal = Number(bk.start_amount||0);
  const byDate = {};
  for(const b of settled){
    byDate[b.date] = (byDate[b.date]||0) + profitOf(b);
  }
  const dates = Object.keys(byDate).sort();
  for(const d of dates){
    bal += byDate[d];
    points.push({x:d, y:bal});
  }
  renderBankrollChart(points);

  // ledger + month tabs
  renderMonthTabs(bets);
  renderLedger(bets);
}

$("#save-bankroll").addEventListener("click", async ()=>{
  const bk = currentBk(); if(!bk) return alert("Pick a bankroll in Home.");
  const val = Number($("#bankroll-start").value||0);
  const { error } = await supabase.from("bankrolls").update({ start_amount: val }).eq("id", bk.id);
  if(error) return alert(error.message);
  await loadBankrolls(); renderOverview();
});

function renderBankrollChart(points){
  const ctx = $("#bankrollChart");
  if(State.charts.bankroll) State.charts.bankroll.destroy();
  State.charts.bankroll = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [{
        label: "Bankroll",
        data: points,
        tension: .35,
        borderWidth: 2,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { x: { type: "time", time: { unit: "day" }}, y: { beginAtZero: false }},
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => fmtEur(ctx.parsed.y) } }
      }
    }
  });
}

// Profit per bet
function profitOf(b){
  const odds = Number(b.odds)||0, stake=Number(b.stake)||0;
  if(b.result==="win") return (odds-1)*stake;
  if(b.result==="loss") return -stake;
  return 0; // void or pending
}

// Month tabs + filter
let LedgerFilter = { monthKey: "ALL" }; // YYYY-MM
function renderMonthTabs(bets){
  const wrap = $("#month-tabs");
  wrap.innerHTML = "";
  const btnAll = document.createElement("button");
  btnAll.className = "month-tab" + (LedgerFilter.monthKey==="ALL"?" active":"");
  btnAll.innerHTML = `All <span class="month-pill ${sumPnl(bets)>=0?"pos":"neg"}">${fmtEur(sumPnl(bets))}</span>`;
  btnAll.addEventListener("click", ()=>{ LedgerFilter.monthKey="ALL"; renderOverview(); });
  wrap.appendChild(btnAll);

  const groups = groupByMonth(bets);
  for(const [k,arr] of Object.entries(groups)){
    const label = new Date(k+"-01").toLocaleDateString(undefined,{year:"numeric",month:"long"});
    const btn = document.createElement("button");
    btn.className = "month-tab"+(LedgerFilter.monthKey===k?" active":"");
    btn.innerHTML = `${label} <span class="month-pill ${sumPnl(arr)>=0?"pos":"neg"}">${fmtEur(sumPnl(arr))}</span>`;
    btn.addEventListener("click", ()=>{ LedgerFilter.monthKey=k; renderOverview(); });
    wrap.appendChild(btn);
  }
}

function groupByMonth(bets){
  const map = {};
  for(const b of bets){
    const key = (b.date||"").slice(0,7); // YYYY-MM
    if(!key) continue;
    (map[key] ||= []).push(b);
  }
  return map;
}
const sumPnl = (arr)=> arr.reduce((s,b)=> s+profitOf(b), 0);

function renderLedger(bets){
  const tbody = $("#ledger tbody");
  tbody.innerHTML = "";
  let rows = bets;
  if(LedgerFilter.monthKey!=="ALL"){
    rows = rows.filter(b => (b.date||"").startsWith(LedgerFilter.monthKey));
  }
  rows.sort((a,b)=> (a.date>b.date? -1:1));
  for(const b of rows){
    const tr = document.createElement("tr");
    const p = profitOf(b);
    tr.innerHTML = `
      <td>${b.date||""}</td>
      <td>${b.sport||""}</td>
      <td>${b.league||""}</td>
      <td>${b.market||""}</td>
      <td>${b.selection||""}</td>
      <td class="right">${Number(b.odds||0).toFixed(2)}</td>
      <td class="right">${fmtEur(b.stake||0)}</td>
      <td>${b.result||"pending"}</td>
      <td class="right" style="color:${p>=0?"#16a34a":"#ef4444"}">${fmtEur(p)}</td>
      <td class="right actions">
        <button class="action-btn action-edit" data-edit="${b.id}">Edit</button>
        <button class="action-btn action-del" data-del="${b.id}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
  // wire actions
  tbody.querySelectorAll("[data-edit]").forEach(btn=>{
    btn.addEventListener("click", ()=> openEditModal(btn.getAttribute("data-edit")));
  });
  tbody.querySelectorAll("[data-del]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      if(!confirm("Delete this bet?")) return;
      const id = btn.getAttribute("data-del");
      await supabase.from("bets").delete().eq("id", id);
      await loadBets(); renderOverview(); renderAnalytics(); renderROI(); renderCalendar();
    });
  });
}

// ===============================
// Edit modal
// ===============================
function wireEditModal(){
  $("#edit-close").addEventListener("click", ()=> $("#edit-modal").classList.add("hidden"));
  $("#edit-cancel").addEventListener("click", ()=> $("#edit-modal").classList.add("hidden"));
  $("#edit-form").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const id = $("#e-id").value;
    const row = {
      date: $("#e-date").value,
      sport: $("#e-sport").value.trim(),
      league: $("#e-league").value.trim()||null,
      market: $("#e-market").value.trim()||null,
      selection: $("#e-selection").value.trim()||null,
      odds: Number($("#e-odds").value||0),
      stake: Number($("#e-stake").value||0),
      result: $("#e-result").value
    };
    const { error } = await supabase.from("bets").update(row).eq("id", id);
    if(error) return alert(error.message);
    $("#edit-modal").classList.add("hidden");
    await loadBets(); renderOverview(); renderAnalytics(); renderROI(); renderCalendar();
  });
}

function openEditModal(id){
  const b = State.bets.find(x=>x.id===id);
  if(!b) return;
  $("#e-id").value = b.id;
  $("#e-date").value = b.date || new Date().toISOString().slice(0,10);
  $("#e-sport").value = b.sport || "";
  $("#e-league").value = b.league || "";
  $("#e-market").value = b.market || "";
  $("#e-selection").value = b.selection || "";
  $("#e-odds").value = b.odds || 1.01;
  $("#e-stake").value = b.stake || 0;
  $("#e-result").value = b.result || "pending";
  $("#edit-modal").classList.remove("hidden");
}

// ===============================
// Analytics
// ===============================
function renderAnalytics(){
  const bk = currentBk(); if(!bk){ fillAnalyticsEmpty(); return; }
  const bets = State.bets.filter(b=>b.bankroll_id===bk.id);
  const settled = bets.filter(b=>b.result==="win"||b.result==="loss"||b.result==="void");

  const net = settled.reduce((s,b)=> s+profitOf(b), 0);
  const staked = bets.reduce((s,b)=> s+(Number(b.stake)||0), 0);
  const avgStake = bets.length? (staked/bets.length):0;
  const avgOdds = bets.length? (bets.reduce((s,b)=> s+(Number(b.odds)||0),0)/bets.length):0;
  const wins = settled.filter(b=>b.result==="win").length;
  const wr = settled.length? wins/settled.length*100:0;
  const pf = (()=>{ 
    const g = settled.filter(b=>b.result==="win").reduce((s,b)=> s+(Number(b.odds)-1)*(Number(b.stake)||0), 0);
    const l = settled.filter(b=>b.result==="loss").reduce((s,b)=> s+(Number(b.stake)||0), 0);
    return l>0? g/l : (g>0? 999:0);
  })();
  const maxDD = computeMaxDrawdown(bk, settled);

  $("#an-net-profit").textContent = fmtEur(net);
  $("#an-staked").textContent = fmtEur(staked);
  $("#avg-stake").textContent = fmtEur(avgStake);
  $("#avg-odds").textContent = (avgOdds||0).toFixed(2);
  $("#an-winrate").textContent = fmtPct(wr);
  $("#an-pf").textContent = (pf||0).toFixed(2);
  $("#max-dd").textContent = fmtEur(maxDD);

  // Edge/Kelly (approx): edge based on avg odds vs winrate
  const be = avgOdds? (100/avgOdds):0;
  const edge = wr - be;
  const kelly = (()=>{
    const b = (avgOdds||1)-1;
    const p = wr/100; const q = 1-p;
    const k = (b>0)? ((b*p - q)/b) : 0;
    return Math.max(0, k*100);
  })();
  $("#edge").textContent = `${edge.toFixed(2)}% / ${kelly.toFixed(2)}%`;

  // Charts
  renderBar("#pnlBySportChart","pnlBySport",pnlBySport(bets));
  renderBar("#winRateBySportChart","wrBySport",winRateBySport(bets), true);
  renderBar("#pnlMonthChart","pnlMonth",pnlByMonth(bets));
  renderBar("#weekdayChart","weekday",profitByWeekday(bets));
  renderBar("#oddsHistChart","oddsHist",oddsHistogram(bets));
  renderPie("#resultsPieChart","resultsPie",resultsBreakdown(bets));
}

function fillAnalyticsEmpty(){
  ["#an-net-profit","#an-staked","#avg-stake","#avg-odds","#an-winrate","#an-pf","#max-dd","#edge"].forEach(id=> $(id).textContent = id==="#avg-odds"?"0.00":(id==="#an-winrate"?"0%":"€0"));
  // Destroy charts if exist
  ["pnlBySport","wrBySport","pnlMonth","weekday","oddsHist","resultsPie"].forEach(k=>{
    if(State.charts[k]){ State.charts[k].destroy(); delete State.charts[k]; }
  });
}

function pnlBySport(bets){
  const map = {};
  for(const b of bets){
    const k = b.sport||"—";
    map[k] = (map[k]||0) + profitOf(b);
  }
  const labels = Object.keys(map); const values = labels.map(l=> map[l]);
  return { labels, values };
}
function winRateBySport(bets){
  const map = {};
  for(const b of bets){
    const k = b.sport||"—";
    const m = (map[k] ||= {w:0, n:0});
    if(b.result==="win") m.w++;
    if(["win","loss","void"].includes(b.result)) m.n++;
  }
  const labels = Object.keys(map);
  const values = labels.map(l => map[l].n? (map[l].w/map[l].n*100):0);
  return { labels, values };
}
function pnlByMonth(bets){
  const map = {};
  for(const b of bets){
    const m = (b.date||"").slice(0,7); if(!m) continue;
    map[m] = (map[m]||0) + profitOf(b);
  }
  const labels = Object.keys(map).sort();
  const values = labels.map(l=> map[l]);
  return { labels, values };
}
function profitByWeekday(bets){
  const map = {0:0,1:0,2:0,3:0,4:0,5:0,6:0};
  for(const b of bets){
    if(!b.date) continue;
    const d = new Date(b.date+"T00:00:00");
    map[d.getDay()] += profitOf(b);
  }
  const labels = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const values = [0,1,2,3,4,5,6].map(i=> map[i]);
  return { labels, values };
}
function oddsHistogram(bets){
  const buckets = {};
  for(const b of bets){
    const o = Number(b.odds||0); if(!o) continue;
    const k = (Math.floor(o*10)/10).toFixed(1); // 1.5, 1.6, ...
    buckets[k] = (buckets[k]||0)+1;
  }
  const labels = Object.keys(buckets).sort((a,b)=> parseFloat(a)-parseFloat(b));
  const values = labels.map(l=> buckets[l]);
  return { labels, values };
}
function resultsBreakdown(bets){
  const c = { win:0, loss:0, void:0, pending:0 };
  for(const b of bets){ c[b.result||"pending"]++; }
  const labels = Object.keys(c);
  const values = labels.map(l=> c[l]);
  return { labels, values };
}

function renderBar(canvasSel, key, {labels, values}, isPct=false){
  const ctx = $(canvasSel);
  if(State.charts[key]) State.charts[key].destroy();
  State.charts[key] = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ data: values }] },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:ctx=> isPct? `${ctx.parsed.y.toFixed(1)}%` : fmtEur(ctx.parsed.y) }}},
      scales:{ y:{ beginAtZero:true } }
    }
  });
}
function renderPie(canvasSel, key, {labels, values}){
  const ctx = $(canvasSel);
  if(State.charts[key]) State.charts[key].destroy();
  State.charts[key] = new Chart(ctx, {
    type: "pie",
    data: { labels, datasets: [{ data: values }]},
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{position:"bottom"} } }
  });
}
function computeMaxDrawdown(bk, settled){
  // equity curve on settled dates
  let bal = Number(bk.start_amount||0);
  const pts = [];
  const byDate = {};
  for(const b of settled){
    byDate[b.date] = (byDate[b.date]||0)+profitOf(b);
  }
  const dates = Object.keys(byDate).sort();
  for(const d of dates){ bal += byDate[d]; pts.push(bal); }
  let peak = -Infinity, maxDD=0;
  for(const v of pts){
    peak = Math.max(peak, v);
    maxDD = Math.max(maxDD, peak - v);
  }
  return maxDD;
}

// ===============================
// ROI
// ===============================
function renderROI(){
  const bk = currentBk(); if(!bk){ ["#roi-overall","#roi-settled","#roi-profit","#roi-stake"].forEach(id=> $(id).textContent="0"); $("#roi-tbody").innerHTML=""; return; }
  const bets = State.bets.filter(b=>b.bankroll_id===bk.id);
  const settled = bets.filter(b=>b.result==="win"||b.result==="loss"||b.result==="void");
  const stake = settled.reduce((s,b)=> s+(Number(b.stake)||0), 0);
  const profit = settled.reduce((s,b)=> s+profitOf(b), 0);
  const roi = stake>0 ? (profit/stake*100):0;
  $("#roi-overall").textContent = fmtPct(roi);
  $("#roi-settled").textContent = settled.length;
  $("#roi-profit").textContent = fmtEur(profit);
  $("#roi-stake").textContent = fmtEur(stake);

  const bySport = {};
  for(const b of settled){
    const k=b.sport||"—";
    const r = (bySport[k] ||= {n:0, stake:0, profit:0});
    r.n++; r.stake += (Number(b.stake)||0); r.profit += profitOf(b);
  }
  const tbody = $("#roi-tbody"); tbody.innerHTML = "";
  for(const [sport, r] of Object.entries(bySport)){
    const tr = document.createElement("tr");
    const roiS = r.stake>0 ? (r.profit/r.stake*100) : 0;
    tr.innerHTML = `
      <td>${sport}</td>
      <td class="right">${r.n}</td>
      <td class="right">${fmtEur(r.stake)}</td>
      <td class="right">${fmtEur(r.profit)}</td>
      <td class="right">${roiS.toFixed(2)}%</td>
    `;
    tbody.appendChild(tr);
  }
}

// ===============================
// Calendar
// ===============================
function wireCalendarUI(){
  $("#cal-prev").addEventListener("click", ()=>{ const c=State.calendar; c.month--; if(c.month<0){c.month=11;c.year--;} renderCalendar(); });
  $("#cal-next").addEventListener("click", ()=>{ const c=State.calendar; c.month++; if(c.month>11){c.month=0;c.year++;} renderCalendar(); });
  $("#clear-filter").addEventListener("click", ()=>{ $("#day-tbody").innerHTML=""; $("#day-selected").textContent="—"; $("#day-pnl").textContent="€0"; renderCalendar(); });
}

function renderCalendar(){
  const bk = currentBk(); 
  $("#calendar-grid").innerHTML = "";
  $("#cal-title").textContent = new Date(State.calendar.year, State.calendar.month, 1).toLocaleDateString(undefined,{year:"numeric", month:"long"});
  if(!bk) return;

  const bets = State.bets.filter(b=>b.bankroll_id===bk.id);
  const first = new Date(State.calendar.year, State.calendar.month, 1);
  const startDay = first.getDay(); // 0..6
  const daysInMonth = new Date(State.calendar.year, State.calendar.month+1, 0).getDate();
  const grid = $("#calendar-grid");

  const dayPnL = {}; const byDayRows = {};
  for(const b of bets){
    const d = b.date;
    if(!d) continue;
    const dt = new Date(d+"T00:00:00");
    if(dt.getFullYear()===State.calendar.year && dt.getMonth()===State.calendar.month){
      const day = dt.getDate();
      dayPnL[day] = (dayPnL[day]||0) + profitOf(b);
      (byDayRows[day] ||= []).push(b);
    }
  }

  // fillers before first
  for(let i=0;i<startDay;i++){
    const cell = document.createElement("div"); cell.className="cell out"; grid.appendChild(cell);
  }
  // month days
  for(let d=1; d<=daysInMonth; d++){
    const cell = document.createElement("div"); cell.className="cell";
    const amt = dayPnL[d]||0;
    const color = amt===0? "#93a0b7" : (amt>0? "#16a34a" : "#ef4444");
    cell.innerHTML = `<div class="date-num">${d}</div><div class="amt" style="color:${color}">${amt===0?"":fmtEur(amt)}</div>`;
    cell.addEventListener("click", ()=>{
      $$(".calendar-grid .cell").forEach(c=>c.classList.remove("active"));
      cell.classList.add("active");
      $("#day-selected").textContent = new Date(State.calendar.year, State.calendar.month, d).toDateString();
      $("#day-pnl").textContent = fmtEur(amt);
      renderDayTable(byDayRows[d]||[]);
    });
    grid.appendChild(cell);
  }
}
function renderDayTable(rows){
  const tb = $("#day-tbody"); tb.innerHTML="";
  for(const b of rows){
    const p = profitOf(b);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${b.sport||""}</td>
      <td>${b.market||""}</td>
      <td>${b.selection||""}</td>
      <td class="right">${Number(b.odds||0).toFixed(2)}</td>
      <td class="right">${fmtEur(b.stake||0)}</td>
      <td class="right">${b.result||""}</td>
      <td class="right" style="color:${p>=0?"#16a34a":"#ef4444"}">${fmtEur(p)}</td>
    `;
    tb.appendChild(tr);
  }
}

// ===============================
// Tools (Risk / Poisson / Masaniello)
// ===============================
function wireToolsUI(){
  $("#tool-btn-risk").addEventListener("click", ()=> showTool("risk"));
  $("#tool-btn-poisson").addEventListener("click", ()=> showTool("poisson"));
  $("#tool-btn-masa").addEventListener("click", ()=> showTool("masa"));

  // Sync number + range
  const link = (numSel, rangeSel) => {
    const num = $(numSel), rng=$(rangeSel);
    if(!num || !rng) return;
    num.addEventListener("input", ()=> rng.value = num.value);
    rng.addEventListener("input", ()=> num.value = rng.value);
  };
  link("#rk-prob","#rk-prob-range");
  link("#rk-cap","#rk-cap-range");
  link("#ms-p","#ms-p-range");

  $("#rk-run").addEventListener("click", runRisk);
  $("#ps-run").addEventListener("click", runPoisson);

  $("#ms-run").addEventListener("click", runMasaniello);
  $("#ms-save").addEventListener("click", saveMasaniello);
  $("#ms-delete").addEventListener("click", deleteMasaniello);
  loadMasanielloList();
}

function showTool(which){
  // chips
  $$(".tools-nav .chip").forEach(c=>c.classList.remove("active"));
  $(`#tool-btn-${which}`).classList.add("active");
  // panels
  ["risk","poisson","masa"].forEach(k => $(`#tools-${k}`).classList.add("hidden"));
  $(`#tools-${which}`).classList.remove("hidden");
}
function renderToolsLanding(){ /* optional: nothing */ }

// ---- Risk
function runRisk(){
  const BR = Number($("#rk-bankroll").value||0);
  const odds = Number($("#rk-odds").value||0);
  const p = Number($("#rk-prob").value||0)/100;
  const capPct = Number($("#rk-cap").value||0)/100;

  if(BR<=0 || odds<=1.01) return alert("Enter bankroll and odds.");

  const be = odds>0 ? 100/odds : 0;
  const edge = p*100 - be;
  const evPer1 = p*(odds-1) - (1-p);
  // Kelly fraction
  const b = odds-1, q = 1-p;
  const kelly = b>0 ? Math.max(0, (b*p - q)/b) : 0;
  const kellyPct = kelly*100;
  $("#rk-be").textContent = `${be.toFixed(2)}%`;
  $("#rk-edge").textContent = `${edge.toFixed(2)}%`;
  $("#rk-ev").textContent = fmtEur(evPer1);
  $("#rk-kelly").textContent = `${kellyPct.toFixed(2)}%`;

  // stakes: flat 1%, half Kelly, capped Kelly
  const flat = BR*0.01;
  const halfK = BR * (kelly/2);
  const capped = BR * Math.min(kelly, capPct);

  renderBarSimple("rkStakeChart","Stake size",["Flat 1%","Half Kelly","Capped Kelly"],[flat,halfK,capped]);
}
function renderBarSimple(canvasId,label,labels,values){
  const ctx = document.getElementById(canvasId);
  const key = canvasId;
  if(State.charts[key]) State.charts[key].destroy();
  State.charts[key] = new Chart(ctx, {
    type:"bar",
    data:{ labels, datasets:[{ label, data: values }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:c=> fmtEur(c.parsed.y) }}}}
  });
}

// ---- Poisson
function runPoisson(){
  const lamH = Number($("#ps-home").value||0);
  const lamA = Number($("#ps-away").value||0);
  const ouLine = Number($("#ps-ouline").value||2.5);

  // Distribution 0..8
  const maxG = 8;
  const pH = []; const pA = [];
  for(let k=0;k<=maxG;k++){
    pH.push(poissonPMF(k, lamH));
    pA.push(poissonPMF(k, lamA));
  }

  // 1X2
  let ph=0, pd=0, pa=0, btts=0;
  const totalGoals = Array(maxG*2+1).fill(0);
  for(let i=0;i<=maxG;i++){
    for(let j=0;j<=maxG;j++){
      const pij = pH[i]*pA[j];
      if(i>j) ph+=pij;
      else if(i===j) pd+=pij;
      else pa+=pij;
      totalGoals[i+j]+=pij;
      if(i>0 && j>0) btts+=pij;
    }
  }

  // Over / Under (approx using totalGoals)
  let over=0;
  for(let tg=0; tg<totalGoals.length; tg++){
    if(tg>ouLine) over += totalGoals[tg];
  }

  // KPIs
  $("#ps-ph").textContent = fmtPct(ph*100);
  $("#ps-pd").textContent = fmtPct(pd*100);
  $("#ps-pa").textContent = fmtPct(pa*100);
  $("#ps-over").textContent = fmtPct(over*100);
  $("#ps-btts").textContent = fmtPct(btts*100);

  // Charts
  renderBarSimple("ps1x2Chart","Prob.",["Home","Draw","Away"],[ph,pd,pa].map(x=>x*100));
  const tgLabels = totalGoals.map((_,i)=> i);
  renderBarSimple("psGoalsChart","%", tgLabels, totalGoals.map(x=>x*100));
  renderBarSimple("psBttsChart","%", ["BTTS Yes","BTTS No"], [btts*100, (1-btts)*100]);

  // Table
  const rows = [
    ["Home", ph, 1/ph],
    ["Draw", pd, 1/pd],
    ["Away", pa, 1/pa],
    ["Over "+ouLine.toFixed(1), over, 1/over],
    ["Under "+ouLine.toFixed(1), 1-over, 1/(1-over)],
    ["BTTS Yes", btts, 1/btts],
    ["BTTS No", 1-btts, 1/(1-btts)]
  ];
  const tb = $("#ps-table"); tb.innerHTML = "";
  for(const r of rows){
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r[0]}</td><td class="right">${(r[1]*100).toFixed(2)}%</td><td class="right">${isFinite(r[2]) ? r[2].toFixed(2) : "—"}</td>`;
    tb.appendChild(tr);
  }
}
function poissonPMF(k, lambda){
  return Math.exp(-lambda) * Math.pow(lambda,k) / factorial(k);
}
const factorial = (n)=> { let r=1; for(let i=2;i<=n;i++) r*=i; return r; };

// ---- Masaniello (simple helper, saved in localStorage)
function runMasaniello(){
  const name = $("#ms-name").value.trim() || "My System";
  const cap0 = Number($("#ms-capital").value||0);
  const target = Number($("#ms-target").value||0);
  const odds = Number($("#ms-odds").value||0);
  const n = parseInt($("#ms-n").value||10,10);
  const p = Number($("#ms-p").value||0)/100;
  const winsDone = parseInt($("#ms-wins").value||0,10);

  if(cap0<=0 || odds<=1.01 || n<=0) return alert("Fill capital, odds and number of bets.");

  // very simple: aim to reach target in n bets using flat stake proportional to target and edge
  const b = odds-1;
  const edge = Math.max(0, (b*p - (1-p)));
  const baseStake = Math.max(1, Math.min(cap0*0.1, (target/n)/Math.max(0.01, b))); // keep reasonable

  const rows = [];
  let cap = cap0;
  for(let i=1;i<=n;i++){
    const stake = Math.min(baseStake, cap*0.1);
    rows.push({ i, stake, result: "", cap });
    // we don't simulate results here; user clicks WIN/LOSS later
  }

  // Fill UI
  $("#ms-q").textContent = `${Math.round(p*n)} (est.)`;
  $("#ms-rem").textContent = `${n - winsDone}`;
  $("#ms-stake").textContent = fmtEur(rows[0]?.stake || 0);
  $("#ms-nextwin").textContent = fmtEur(cap0 + rows[0]?.stake*b || 0);
  $("#ms-nextloss").textContent = fmtEur(cap0 - rows[0]?.stake || 0);

  const tb = $("#ms-rows"); tb.innerHTML = "";
  for(const r of rows){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.i}</td>
      <td class="right">${fmtEur(r.stake)}</td>
      <td class="right"><select data-ms-res="${r.i}"><option value="">—</option><option value="W">WIN</option><option value="L">LOSS</option></select></td>
      <td class="right" data-ms-cap="${r.i}">${fmtEur(r.cap)}</td>
      <td class="right"><button class="action-btn" data-ms-apply="${r.i}">Apply</button></td>
    `;
    tb.appendChild(tr);
  }
  // wire
  tb.querySelectorAll("[data-ms-apply]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const i = parseInt(btn.getAttribute("data-ms-apply"),10);
      const sel = tb.querySelector(`[data-ms-res="${i}"]`);
      const val = sel.value;
      if(!val) return;
      const capCell = tb.querySelector(`[data-ms-cap="${i}"]`);
      const st = rows[i-1].stake;
      const oldCap = rows[i-1].cap;
      const newCap = (val==="W") ? oldCap + st*(odds-1) : oldCap - st;
      capCell.textContent = fmtEur(newCap);
      if(rows[i]){ rows[i].cap = newCap; tb.querySelector(`[data-ms-cap="${i+1}"]`).textContent = fmtEur(newCap); }
    });
  });

  // keep in memory for Save
  State._lastMasa = { name, cap0, target, odds, n, p: p*100, winsDone, rows };
}
function saveMasaniello(){
  if(!State._lastMasa) return alert("Run a system first.");
  const list = JSON.parse(localStorage.getItem("quantara_masa")||"[]");
  list.push({ ...State._lastMasa, savedAt: Date.now() });
  localStorage.setItem("quantara_masa", JSON.stringify(list));
  loadMasanielloList();
}
function loadMasanielloList(){
  const list = JSON.parse(localStorage.getItem("quantara_masa")||"[]");
  const sel = $("#ms-load");
  sel.innerHTML = `<option value="">Load saved…</option>`;
  list.forEach((it, idx)=>{
    const opt = document.createElement("option");
    const dt = new Date(it.savedAt).toLocaleString();
    opt.value = idx; opt.textContent = `${it.name} — ${dt}`;
    sel.appendChild(opt);
  });
  sel.onchange = ()=>{
    const i = sel.value; if(i==="") return;
    const it = list[i];
    $("#ms-name").value = it.name;
    $("#ms-capital").value = it.cap0;
    $("#ms-target").value = it.target;
    $("#ms-odds").value = it.odds;
    $("#ms-n").value = it.n;
    $("#ms-p").value = it.p;
    $("#ms-p-range").value = it.p;
    $("#ms-wins").value = it.winsDone;
    runMasaniello();
  };
}
function deleteMasaniello(){
  const sel = $("#ms-load");
  const i = sel.value;
  if(i==="") return alert("Select a saved system first.");
  const list = JSON.parse(localStorage.getItem("quantara_masa")||"[]");
  list.splice(i,1);
  localStorage.setItem("quantara_masa", JSON.stringify(list));
  loadMasanielloList();
}

// ===============================
// Utils
// ===============================
function computeProfitForBankroll(bkId){
  const rows = State.bets.filter(b=>b.bankroll_id===bkId && (b.result==="win"||b.result==="loss"||b.result==="void"));
  return rows.reduce((s,b)=> s+profitOf(b), 0);
}
