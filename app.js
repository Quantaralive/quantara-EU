// ===============================
// QUANTARA — AI Betting Diary
// Frontend: GitHub Pages (static)
// Auth/DB: Supabase (anon key)
// Charts: Chart.js v4
// Version: v20
// ===============================

// ---- Supabase setup (public anon key is OK for browser apps)
const SUPABASE_URL = "https://bycktplwlfrdjxghajkg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5Y2t0cGx3bGZyZGp4Z2hhamtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUxNjM0MjEsImV4cCI6MjA3MDczOTQyMX0.ovDq1RLEEuOrTNeSek6-lvclXWmJfOz9DoHOv_L71iw";

// Supabase v2
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true } });

// ---- Helpers
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const on = (sel, evt, fn) => { const el = $(sel); if(el) el.addEventListener(evt, fn); };
const fmtEur = (n) => `€${(Number(n)||0).toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:2})}`;
const fmtPct = (n) => `${(Number(n)||0).toFixed(1)}%`;

// ---- App state
const State = {
  user: null,
  activeTab: "home",
  activeBankrollId: localStorage.getItem("quantara_active_bankroll_id") || null,
  charts: {},
  bets: [],
  bankrolls: [],
  calendar: { year: new Date().getFullYear(), month: new Date().getMonth() },
};

// Expose router
window.__go = (t) => switchTab(t);

// Global error logging
window.addEventListener("error", (e)=> console.error("Global error:", e.error || e.message || e));
window.addEventListener("unhandledrejection", (e)=> console.error("Unhandled promise rejection:", e.reason || e));

// ---- Boot
console.log("Quantara boot v20");
document.addEventListener("DOMContentLoaded", init);

async function init(){
  try{
    wireAuthUI();
    wireOverviewControls();
    wireLedgerUI();
    wireEditModal();
    wireBankrollModal();
    wireCalendarUI();
    wireToolsUI();

    await refreshAuth();
    switchTab(State.activeTab || "home");
  }catch(err){
    console.error("Init failed:", err);
  }
}

// ===============================
// Auth
// ===============================
function wireAuthUI(){
  on("#signup","click", async () => {
    const email = $("#email")?.value?.trim();
    const password = $("#password")?.value;
    if(!email || !password) return alert("Email + password required.");
    const { error } = await supabase.auth.signUp({ email, password });
    if(error) return alert(error.message);
    alert("Check your inbox to confirm your email.");
  });

  on("#signin","click", async () => {
    const email = $("#email")?.value?.trim();
    const password = $("#password")?.value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if(error) return alert(error.message);
  });

  on("#send-link","click", async () => {
    const email = $("#email")?.value?.trim();
    if(!email) return alert("Enter your email.");
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href }});
    if(error) return alert(error.message);
    alert("Magic link sent.");
  });

  on("#signout","click", async () => { await supabase.auth.signOut(); });

  supabase.auth.onAuthStateChange(async (_evt, session) => {
    State.user = session?.user || null;
    const so = $("#signout"); if(so) so.style.display = State.user ? "" : "none";
    await loadEverything();
  });
}

async function refreshAuth(){
  const { data } = await supabase.auth.getSession();
  State.user = data.session?.user || null;
  const so = $("#signout"); if(so) so.style.display = State.user ? "" : "none";
}

// ===============================
// Router
// ===============================
function switchTab(tab){
  State.activeTab = tab;
  $$(".tabs .tab").forEach(btn => btn.classList.remove("active"));
  $(`#tab-btn-${tab}`)?.classList.add("active");

  ["home","overview","analytics","roi","calendar","tools"].forEach(id=>{
    const el = $(`#tab-${id}`);
    if(el) el.classList.toggle("hidden", id !== tab);
  });

  if(tab === "home") renderHome();
  if(tab === "overview") renderOverview();
  if(tab === "analytics") renderAnalytics();
  if(tab === "roi") renderROI();
  if(tab === "calendar") renderCalendar();
  if(tab === "tools") renderToolsLanding();
}

// ===============================
// Load everything
// ===============================
async function loadEverything(){
  await loadBankrolls();
  if(State.activeBankrollId && !State.bankrolls.find(b=>b.id===State.activeBankrollId)){
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
  if(!State.user){ State.bankrolls = []; return; }
  const { data, error } = await supabase
    .from("bankrolls").select("*")
    .eq("user_id", State.user.id)
    .order("created_at", { ascending: true });
  if(error){ console.error(error); State.bankrolls = []; return; }
  State.bankrolls = data || [];
}

function renderHome(){
  const curr = State.bankrolls.find(b=>b.id===State.activeBankrollId);
  const currEl = $("#current-bk"); if(currEl) currEl.textContent = curr ? `${curr.name} — ${fmtEur(curr.start_amount || 0)}` : "None selected";

  const wrap = $("#bankroll-grid"); if(!wrap) return;
  wrap.innerHTML = "";
  if(!State.user){ wrap.innerHTML = `<div class="muted">Sign in to create bankrolls.</div>`; return; }
  if(State.bankrolls.length===0){ wrap.innerHTML = `<div class="muted">No bankrolls yet. Click “New bankroll”.</div>`; return; }

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

  const counts = countBetsPerBk();
  Object.entries(counts).forEach(([bkId,count])=>{
    const el = document.querySelector(`[data-bk-count="${bkId}"]`);
    if(el) el.textContent = count;
  });

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

window.__openBkModal = ()=>{ $("#bk-modal")?.classList.remove("hidden"); const n=$("#bk-name"); if(n) n.value=""; const s=$("#bk-start"); if(s) s.value=""; };
window.__clearActive = ()=>{ State.activeBankrollId=null; localStorage.removeItem("quantara_active_bankroll_id"); renderHome(); };

// Create / modal
function wireBankrollModal(){
  on("#bk-close","click", ()=> $("#bk-modal")?.classList.add("hidden"));
  on("#bk-cancel","click", ()=> $("#bk-modal")?.classList.add("hidden"));

  on("#bk-form","submit", async (e)=>{
    e.preventDefault();
    if(!State.user) return alert("Sign in first.");
    const name = $("#bk-name")?.value?.trim();
    const start = Number($("#bk-start")?.value||0);
    if(!name) return alert("Please enter a name.");
    if(Number.isNaN(start)) return alert("Please enter a valid starting amount.");

    const { data, error } = await supabase
      .from("bankrolls").insert([{ user_id: State.user.id, name, start_amount: start }])
      .select().single();

    if(error){ console.error("Create bankroll error:", error); return alert(error.message || "Could not create bankroll."); }

    $("#bk-modal")?.classList.add("hidden");
    await loadBankrolls(); renderHome();
    if(data?.id){
      State.activeBankrollId = data.id;
      localStorage.setItem("quantara_active_bankroll_id", data.id);
      switchTab("overview");
    }
  });
}

// Helper
function currentBk(){ return State.bankrolls.find(b=>b.id===State.activeBankrollId) || null; }

// ===============================
// Overview
// ===============================
function wireOverviewControls(){
  on("#save-bankroll","click", async ()=>{
    const bk = currentBk(); if(!bk) return alert("Pick a bankroll in Home.");
    const val = Number($("#bankroll-start")?.value||0);
    const { error } = await supabase.from("bankrolls").update({ start_amount: val }).eq("id", bk.id);
    if(error) return alert(error.message);
    await loadBankrolls(); renderOverview();
  });
}

function renderOverview(){
  const bk = currentBk();
  const n1=$("#bk-name-inline"), n2=$("#bk-name-inline-2");
  if(n1) n1.textContent = bk?.name || "—";
  if(n2) n2.textContent = bk?.name || "—";

  if(!bk){
    $("#bankroll") && ($("#bankroll").textContent = "€0");
    $("#staked") && ($("#staked").textContent = "€0");
    $("#winrate") && ($("#winrate").textContent = "0%");
    const s=$("#bankroll-start"); if(s) s.value = "";
    renderBankrollChart([]); renderLedger([]);
    return;
  }
  const s=$("#bankroll-start"); if(s) s.value = bk.start_amount || 0;

  const bets = State.bets.filter(b=>b.bankroll_id===bk.id);
  const settled = bets.filter(b=>b.result==="win"||b.result==="loss"||b.result==="void");
  const pnl = settled.reduce((s,b)=> s + profitOf(b), 0);
  const staked = bets.reduce((s,b)=> s + (Number(b.stake)||0), 0);
  const wins = settled.filter(b=>b.result==="win").length;
  const wr = settled.length? (wins/settled.length*100):0;

  $("#bankroll") && ($("#bankroll").textContent = fmtEur((bk.start_amount||0)+pnl));
  $("#staked") && ($("#staked").textContent = fmtEur(staked));
  $("#winrate") && ($("#winrate").textContent = fmtPct(wr));

  const points = [];
  let bal = Number(bk.start_amount||0);
  const byDate = {};
  for(const b of settled){ byDate[b.date] = (byDate[b.date]||0) + profitOf(b); }
  const dates = Object.keys(byDate).sort();
  for(const d of dates){ bal += byDate[d]; points.push({x:d, y:bal}); }
  renderBankrollChart(points);

  renderMonthTabs(bets);
  renderLedger(bets);
}

function renderBankrollChart(points){
  const ctx = $("#bankrollChart"); if(!ctx) return;
  if(State.charts.bankroll) { State.charts.bankroll.destroy(); State.charts.bankroll=null; }
  State.charts.bankroll = new Chart(ctx, {
    type: "line",
    data: { datasets: [{ label: "Bankroll", data: points, tension: .35, borderWidth: 2, fill: true }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { x: { type: "time", time: { unit: "day" }}, y: { beginAtZero: false }},
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmtEur(c.parsed.y) } } }
    }
  });
}

// Profit per bet
function profitOf(b){
  const odds = Number(b.odds)||0, stake=Number(b.stake)||0;
  if(b.result==="win") return (odds-1)*stake;
  if(b.result==="loss") return -stake;
  return 0;
}

// Month tabs + filter
let LedgerFilter = { monthKey: "ALL" }; // YYYY-MM
function renderMonthTabs(bets){
  const wrap = $("#month-tabs"); if(!wrap) return;
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
    const key = (b.date||"").slice(0,7); if(!key) continue;
    (map[key] ||= []).push(b);
  }
  return map;
}
const sumPnl = (arr)=> arr.reduce((s,b)=> s+profitOf(b), 0);

function renderLedger(bets){
  const tbody = $("#ledger tbody"); if(!tbody) return;
  tbody.innerHTML = "";
  let rows = bets;
  if(LedgerFilter.monthKey!=="ALL"){ rows = rows.filter(b => (b.date||"").startsWith(LedgerFilter.monthKey)); }
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
// Bets (load & add form)
// ===============================
async function loadBets(){
  if(!State.user){ State.bets = []; return; }
  const { data, error } = await supabase
    .from("bets").select("*")
    .eq("user_id", State.user.id)
    .order("date", { ascending: true });
  if(error){ console.error(error); State.bets = []; return; }
  State.bets = data || [];
}

function wireLedgerUI(){
  on("#add-form","submit", async (e)=>{
    e.preventDefault();
    if(!State.user) return alert("Sign in first.");
    const bk = currentBk(); if(!bk) return alert("Select a bankroll in Home.");
    const row = {
      user_id: State.user.id,
      bankroll_id: bk.id,
      date: $("#f-date")?.value || new Date().toISOString().slice(0,10),
      sport: $("#f-sport")?.value?.trim(),
      league: $("#f-league")?.value?.trim() || null,
      market: $("#f-market")?.value?.trim() || null,
      selection: $("#f-selection")?.value?.trim() || null,
      odds: Number($("#f-odds")?.value||0),
      stake: Number($("#f-stake")?.value||0),
      result: $("#f-result")?.value || "pending",
    };
    const { error } = await supabase.from("bets").insert(row);
    if(error) return alert(error.message);
    const sel=$("#f-selection"); if(sel) sel.value = "";
    await loadBets();
    renderOverview(); renderAnalytics(); renderROI(); renderCalendar();
  });
}

// ===============================
// Edit modal
// ===============================
function wireEditModal(){
  on("#edit-close","click", ()=> $("#edit-modal")?.classList.add("hidden"));
  on("#edit-cancel","click", ()=> $("#edit-modal")?.classList.add("hidden"));
  on("#edit-form","submit", async (e)=>{
    e.preventDefault();
    const id = $("#e-id")?.value;
    const row = {
      date: $("#e-date")?.value,
      sport: $("#e-sport")?.value?.trim(),
      league: $("#e-league")?.value?.trim()||null,
      market: $("#e-market")?.value?.trim()||null,
      selection: $("#e-selection")?.value?.trim()||null,
      odds: Number($("#e-odds")?.value||0),
      stake: Number($("#e-stake")?.value||0),
      result: $("#e-result")?.value
    };
    const { error } = await supabase.from("bets").update(row).eq("id", id);
    if(error) return alert(error.message);
    $("#edit-modal")?.classList.add("hidden");
    await loadBets(); renderOverview(); renderAnalytics(); renderROI(); renderCalendar();
  });
}

function openEditModal(id){
  const b = State.bets.find(x=>x.id===id);
  if(!b) return;
  const set = (sel,val)=>{ const el=$(sel); if(el) el.value=val; };
  set("#e-id", b.id);
  set("#e-date", b.date || new Date().toISOString().slice(0,10));
  set("#e-sport", b.sport || "");
  set("#e-league", b.league || "");
  set("#e-market", b.market || "");
  set("#e-selection", b.selection || "");
  set("#e-odds", b.odds || 1.01);
  set("#e-stake", b.stake || 0);
  set("#e-result", b.result || "pending");
  $("#edit-modal")?.classList.remove("hidden");
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

  $("#an-net-profit") && ($("#an-net-profit").textContent = fmtEur(net));
  $("#an-staked") && ($("#an-staked").textContent = fmtEur(staked));
  $("#avg-stake") && ($("#avg-stake").textContent = fmtEur(avgStake));
  $("#avg-odds") && ($("#avg-odds").textContent = (avgOdds||0).toFixed(2));
  $("#an-winrate") && ($("#an-winrate").textContent = fmtPct(wr));
  $("#an-pf") && ($("#an-pf").textContent = (pf||0).toFixed(2));
  $("#max-dd") && ($("#max-dd").textContent = fmtEur(maxDD));

  const be = avgOdds? (100/avgOdds):0;
  const edge = wr - be;
  const kelly = (()=>{
    const b = (avgOdds||1)-1;
    const p = wr/100; const q = 1-p;
    const k = (b>0)? ((b*p - q)/b) : 0;
    return Math.max(0, k*100);
  })();
  $("#edge") && ($("#edge").textContent = `${edge.toFixed(2)}% / ${kelly.toFixed(2)}%`);

  renderBar("#pnlBySportChart","pnlBySport",pnlBySport(bets));
  renderBar("#winRateBySportChart","wrBySport",winRateBySport(bets), true);
  renderBar("#pnlMonthChart","pnlMonth",pnlByMonth(bets));
  renderBar("#weekdayChart","weekday",profitByWeekday(bets));
  renderBar("#oddsHistChart","oddsHist",oddsHistogram(bets));
  renderPie("#resultsPieChart","resultsPie",resultsBreakdown(bets));
}

function fillAnalyticsEmpty(){
  ["#an-net-profit","#an-staked","#avg-stake","#avg-odds","#an-winrate","#an-pf","#max-dd","#edge"].forEach(id=>{
    const el=$(id); if(!el) return;
    el.textContent = id==="#avg-odds"?"0.00":(id==="#an-winrate"?"0%":"€0");
  });
  ["pnlBySport","wrBySport","pnlMonth","weekday","oddsHist","resultsPie"].forEach(k=>{
    if(State.charts[k]){ State.charts[k].destroy(); delete State.charts[k]; }
  });
}

function pnlBySport(bets){
  const map = {};
  for(const b of bets){ const k = b.sport||"—"; map[k] = (map[k]||0) + profitOf(b); }
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
    const k = (Math.floor(o*10)/10).toFixed(1);
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
  const ctx = $(canvasSel); if(!ctx) return;
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
  const ctx = $(canvasSel); if(!ctx) return;
  if(State.charts[key]) State.charts[key].destroy();
  State.charts[key] = new Chart(ctx, {
    type: "pie",
    data: { labels, datasets: [{ data: values }]},
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{position:"bottom"} } }
  });
}
function computeMaxDrawdown(bk, settled){
  let bal = Number(bk.start_amount||0);
  const pts = [];
  const byDate = {};
  for(const b of settled){ byDate[b.date] = (byDate[b.date]||0)+profitOf(b); }
  const dates = Object.keys(byDate).sort();
  for(const d of dates){ bal += byDate[d]; pts.push(bal); }
  let peak = -Infinity, maxDD=0;
  for(const v of pts){ peak = Math.max(peak, v); maxDD = Math.max(maxDD, peak - v); }
  return maxDD;
}

// ===============================
// ROI
// ===============================
function renderROI(){
  const bk = currentBk(); 
  const tbody = $("#roi-tbody");
  if(!bk){ 
    ["#roi-overall","#roi-settled","#roi-profit","#roi-stake"].forEach(id=> { const el=$(id); if(el) el.textContent="0"; });
    if(tbody) tbody.innerHTML="";
    return; 
  }
  const bets = State.bets.filter(b=>b.bankroll_id===bk.id);
  const settled = bets.filter(b=>b.result==="win"||b.result==="loss"||b.result==="void");
  const stake = settled.reduce((s,b)=> s+(Number(b.stake)||0), 0);
  const profit = settled.reduce((s,b)=> s+profitOf(b), 0);
  const roi = stake>0 ? (profit/stake*100):0;
  $("#roi-overall") && ($("#roi-overall").textContent = fmtPct(roi));
  $("#roi-settled") && ($("#roi-settled").textContent = settled.length);
  $("#roi-profit") && ($("#roi-profit").textContent = fmtEur(profit));
  $("#roi-stake") && ($("#roi-stake").textContent = fmtEur(stake));

  if(!tbody) return;
  const bySport = {};
  for(const b of settled){
    const k=b.sport||"—";
    const r = (bySport[k] ||= {n:0, stake:0, profit:0});
    r.n++; r.stake += (Number(b.stake)||0); r.profit += profitOf(b);
  }
  tbody.innerHTML = "";
  for(const [sport, r] of Object.entries(bySport)){
    const tr = document.createElement("tr");
    const roiS = r.stake>0 ? (r.profit/r.stake*100) : 0;
    tr.innerHTML = `
      <td>${sport}</td>
     
