// app.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://bycktplwlfrdjxghajkg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5Y2t0cGx3bGZyZGp4Z2hhamtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUxNjM0MjEsImV4cCI6MjA3MDczOTQyMX0.ovDq1RLEEuOrTNeSek6-lvclXWmJfOz9DoHOv_L71iw";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* -------- State -------- */
let bankrollStart = Number(localStorage.getItem("quantara_bankroll_start") || "10000");
let allBets = [];
let bankrollChart, analyticsStakeChart, pnlBarChart, oddsHistChart, resultsPieChart;
let filterDateISO = null;
let selectedCalendarISO = null;
let currentMonth = new Date();

/* -------- Helpers -------- */
const $ = (id) => document.getElementById(id);
const q = (sel) => document.querySelector(sel);
const euro = (n) => new Intl.NumberFormat("it-IT",{style:"currency",currency:"EUR"}).format(n||0);
const euroShort = (n) => {
  const abs = Math.abs(n);
  const sign = n<0 ? "-" : "";
  if (abs >= 1000) return `${sign}€${(abs/1000).toFixed(1)}k`;
  return `${sign}€${abs.toFixed(0)}`;
};
const emptyNull = (id) => { const v = ($(id).value || "").trim(); return v===""? null : v; };

/* Gradients */
function lineGradient(ctx){
  const {ctx: g, chartArea} = ctx.chart; if(!chartArea) return "#7c3aed";
  const grad = g.createLinearGradient(chartArea.left, chartArea.top, chartArea.right, chartArea.bottom);
  grad.addColorStop(0, "rgba(34,211,238,0.35)");
  grad.addColorStop(1, "rgba(124,58,237,0.10)");
  return grad;
}
function ringGradient(ctx, idx){
  const c = ctx.chart; const { ctx: g, chartArea } = c; if (!chartArea) return "#22d3ee";
  const palettes = [
    ["#22d3ee","#7c3aed"],["#34d399","#0ea5e9"],
    ["#f472b6","#8b5cf6"],["#fde047","#22d3ee"],["#f97316","#22c55e"]
  ];
  const pair = palettes[idx % palettes.length];
  const grad = g.createLinearGradient(chartArea.left, chartArea.top, chartArea.right, chartArea.bottom);
  grad.addColorStop(0, pair[0]); grad.addColorStop(1, pair[1]); return grad;
}
const donutShadow = {
  id:"donutShadow", beforeDatasetDraw(chart){ if(chart.config.type!=="doughnut") return;
    const ctx = chart.ctx; ctx.save(); ctx.shadowColor="rgba(0,0,0,0.35)"; ctx.shadowBlur=14; ctx.shadowOffsetY=8; },
  afterDatasetDraw(chart){ if(chart.config.type!=="doughnut") return; chart.ctx.restore(); }
};

/* -------- Tabs -------- */
function setTab(tab){
  const blocks = {
    overview: $("tab-overview"),
    analytics: $("tab-analytics"),
    roi: $("tab-roi"),
    calendar: $("tab-calendar")
  };
  const buttons = {
    overview: $("tab-btn-overview"),
    analytics: $("tab-btn-analytics"),
    roi: $("tab-btn-roi"),
    calendar: $("tab-btn-calendar")
  };
  Object.values(blocks).forEach(b => b.classList.add("hidden"));
  Object.values(buttons).forEach(b => b.classList.remove("active"));
  blocks[tab].classList.remove("hidden");
  buttons[tab].classList.add("active");

  if (tab === "analytics") renderAnalytics();
  if (tab === "roi") renderROI();
  if (tab === "calendar") { drawCalendar(); updateDayBox(); }
}

/* -------- Startup -------- */
window.addEventListener("DOMContentLoaded", () => {
  /* Tabs */
  $("tab-btn-overview").addEventListener("click", () => setTab("overview"));
  $("tab-btn-analytics").addEventListener("click", () => setTab("analytics"));
  $("tab-btn-roi").addEventListener("click", () => setTab("roi"));
  $("tab-btn-calendar").addEventListener("click", () => setTab("calendar"));

  /* Bankroll setting */
  $("bankroll-start").value = String(bankrollStart);
  $("save-bankroll").addEventListener("click", () => {
    const v = Number($("bankroll-start").value || "0");
    bankrollStart = isNaN(v) ? 10000 : v;
    localStorage.setItem("quantara_bankroll_start", String(bankrollStart));
    renderKPIs();
    drawBankrollChart();
    if (!$("tab-analytics").classList.contains("hidden")) renderAnalytics();
  });

  /* Auth */
  $("signup").addEventListener("click", async () => {
    const email = ($("email").value || "").trim();
    const password = ($("password").value || "").trim();
    if (!email || !password) return alert("Enter email and password");
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) return alert(error.message);
    alert("Account created. Now click 'Sign in'.");
  });
  $("signin").addEventListener("click", async () => {
    const email = ($("email").value || "").trim();
    const password = ($("password").value || "").trim();
    if (!email || !password) return alert("Enter email and password");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return alert(error.message);
    await render();
  });
  $("send-link").addEventListener("click", async () => {
    const email = ($("email").value || "").trim();
    if (!email) return alert("Enter your email");
    const redirect = window.location.origin + window.location.pathname.replace(/\/?$/, "/");
    const { error } = await supabase.auth.signInWithOtp({ email, options:{ emailRedirectTo: redirect }});
    if (error) alert(error.message); else alert("Check your email for the magic link.");
  });
  $("signout").addEventListener("click", async () => {
    await supabase.auth.signOut();
    q(".container").style.display = "none";
    $("signout").style.display = "none";
  });

  /* Add bet */
  $("add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { data:{ user } } = await supabase.auth.getUser();
    if (!user) return alert("Please sign in first.");
    const payload = {
      event_date: $("f-date").value ? new Date($("f-date").value).toISOString() : new Date().toISOString(),
      sport:     $("f-sport").value || "Football",
      league:    emptyNull("f-league"),
      market:    emptyNull("f-market"),
      selection: emptyNull("f-selection"),
      odds:  parseFloat($("f-odds").value  || "1.80"),
      stake: parseFloat($("f-stake").value || "100"),
      result: $("f-result").value,
      notes: null
    };
    const { error } = await supabase.from("bets").insert(payload);
    if (error) return alert("Insert failed: " + error.message);
    e.target.reset();
    await render();
  });

  /* Calendar controls */
  $("cal-prev").addEventListener("click", () => { currentMonth.setMonth(currentMonth.getMonth()-1); drawCalendar(); });
  $("cal-next").addEventListener("click", () => { currentMonth.setMonth(currentMonth.getMonth()+1); drawCalendar(); });
  $("clear-filter").addEventListener("click", () => { selectedCalendarISO = null; filterDateISO = null; drawCalendar(); updateDayBox(); });

  render();
});

/* -------- Data load & core renders -------- */
async function render(){
  const { data:{ session } } = await supabase.auth.getSession();
  if (!session) {
    q(".container").style.display = "none";
    $("signout").style.display = "none";
    return;
  }
  $("signout").style.display = "inline-block";
  q(".container").style.display = "block";

  await supabase.from("profiles").upsert({ id: session.user.id });

  const { data, error } = await supabase
    .from("bets_enriched")
    .select("*")
    .order("event_date", { ascending:true });
  if (error) { alert(error.message); return; }

  allBets = (data || []).map(r => ({
    id: r.id,
    date: (r.event_date || "").slice(0,10),
    sport: r.sport || "",
    league: r.league || "",
    market: r.market || "",
    selection: r.selection || "",
    odds: Number(r.odds) || 0,
    stake: Number(r.stake) || 0,
    result: r.result,
    profit: r.result==="win" ? (Number(r.odds)-1)*Number(r.stake)
          : r.result==="loss" ? -Number(r.stake) : 0
  }));

  renderKPIs();
  drawBankrollChart();
  renderLedger();

  if (!$("tab-analytics").classList.contains("hidden")) renderAnalytics();
  if (!$("tab-roi").classList.contains("hidden")) renderROI();
  if (!$("tab-calendar").classList.contains("hidden")) { drawCalendar(); updateDayBox(); }
}

/* -------- KPIs & Ledger -------- */
function renderKPIs(){
  const totalStake  = allBets.reduce((s,b)=> s + b.stake, 0);
  const totalProfit = allBets.reduce((s,b)=> s + b.profit, 0);
  const settled     = allBets.filter(b => b.result !== "pending");
  const winRate     = settled.length ? (settled.filter(b=>b.result==="win").length / settled.length * 100) : 0;

  $("bankroll").textContent = euro(bankrollStart + totalProfit);
  $("staked").textContent   = euro(totalStake);
  $("winrate").textContent  = winRate.toFixed(1) + "%";
}

function renderLedger(){
  const tbody = q("#ledger tbody");
  tbody.innerHTML = "";
  const rows = filterDateISO ? allBets.filter(b => b.date === filterDateISO) : allBets;

  rows.forEach(b => {
    const tr = document.createElement("tr");
    const cls = b.profit>=0 ? "profit-pos" : "profit-neg";
    tr.innerHTML = `
      <td>${b.date}</td>
      <td>${b.sport}</td>
      <td>${b.league}</td>
      <td>${b.market}</td>
      <td>${b.selection}</td>
      <td class="right">${b.odds.toFixed(2)}</td>
      <td class="right">€${b.stake.toFixed(2)}</td>
      <td class="right">${b.result}</td>
      <td class="right ${cls}">€${b.profit.toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* -------- Charts -------- */
function drawBankrollChart(){
  const ctx = $("bankrollChart").getContext("2d");
  const sorted = [...allBets].sort((a,b)=> a.date.localeCompare(b.date));
  let cum = bankrollStart;
  const labels = [], data = [];
  sorted.forEach(b => { cum += b.profit; labels.push(b.date); data.push(Number(cum.toFixed(2))); });

  if (bankrollChart) bankrollChart.destroy();
  bankrollChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [{ label:"Bankroll (€)", data, tension:.35, borderWidth:2, pointRadius:0, fill:true, backgroundColor: (c)=>lineGradient(c) }] },
    options: {
      responsive:true,
      plugins:{ legend:{ display:false }},
      scales:{
        x:{ ticks:{ color:"#93a0b7" }, grid:{ color:"rgba(147,160,183,0.1)" }},
        y:{ ticks:{ color:"#93a0b7" }, grid:{ color:"rgba(147,160,183,0.1)" }}
      }
    }
  });
}

/* -------- Analytics -------- */
function renderAnalytics(){
  const settled = allBets.filter(b => b.result !== "pending");
  const avgOdds = settled.length ? settled.reduce((s,b)=> s + b.odds, 0) / settled.length : 0;
  $("avg-odds").textContent = avgOdds.toFixed(2);

  $("max-dd").textContent = euro(computeMaxDrawdown());
  $("bets-total").textContent = String(allBets.length);
  $("bets-pending").textContent = String(allBets.filter(b => b.result==="pending").length);

  drawAnalyticsStakeChart();
  drawPnlBarChart();
  drawOddsHistogram();
  drawResultsPie();
}

function drawAnalyticsStakeChart(){
  const wrap = q(".donut-wrap-lg");
  const canvas = $("analyticsStakeChart");
  const ctx = canvas.getContext("2d");
  canvas.width  = wrap.clientWidth;
  canvas.height = wrap.clientHeight;

  const bySport = {};
  allBets.forEach(b => { bySport[b.sport] = (bySport[b.sport] || 0) + b.stake; });
  const labels = Object.keys(bySport);
  const values = Object.values(bySport);

  if (analyticsStakeChart) analyticsStakeChart.destroy();
  analyticsStakeChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: values,
        borderWidth: 1,
        borderColor: "#0d1524",
        backgroundColor: (c) => ringGradient(c, c.dataIndex),
        hoverOffset: 6
      }]
    },
    options: { responsive:false, maintainAspectRatio:false, plugins:{ legend:{ labels:{ color:"#e7eefc" } } }, cutout:"76%", radius:"70%" },
    plugins:[donutShadow]
  });
}

function drawPnlBarChart(){
  const ctx = $("pnlBarChart").getContext("2d");
  const daily = groupByDateSum(allBets.map(b => ({date:b.date, pnl:b.profit})));
  const labels = daily.map(d => d.date);
  const values = daily.map(d => Number(d.pnl.toFixed(2)));

  if (pnlBarChart) pnlBarChart.destroy();
  pnlBarChart = new Chart(ctx, {
    type:"bar",
    data:{ labels, datasets:[{ label:"P&L (€)", data:values }] },
    options:{
      responsive:true,
      plugins:{ legend:{ display:false } },
      scales:{
        x:{ ticks:{ color:"#93a0b7" }, grid:{ display:false } },
        y:{ ticks:{ color:"#93a0b7" }, grid:{ color:"rgba(147,160,183,0.1)" } }
      }
    }
  });
}

function drawOddsHistogram(){
  const ctx = $("oddsHistChart").getContext("2d");
  const bins = [[1,1.5],[1.5,2],[2,2.5],[2.5,3],[3,10]];
  const labels = ["1–1.5","1.5–2","2–2.5","2.5–3","3+"];
  const counts = bins.map(([lo,hi]) => allBets.filter(b => b.odds>=lo && b.odds<(hi||1e9)).length);

  if (oddsHistChart) oddsHistChart.destroy();
  oddsHistChart = new Chart(ctx, {
    type:"bar",
    data:{ labels, datasets:[{ label:"Bets", data:counts }] },
    options:{
      responsive:true,
      plugins:{ legend:{ display:false } },
      scales:{
        x:{ ticks:{ color:"#93a0b7" }, grid:{ display:false } },
        y:{ ticks:{ color:"#93a0b7" }, grid:{ color:"rgba(147,160,183,0.1)" }, beginAtZero:true, precision:0 }
      }
    }
  });
}

function drawResultsPie(){
  const ctx = $("resultsPieChart").getContext("2d");
  const counts = { win:0, loss:0, pending:0, void:0 };
  allBets.forEach(b => counts[b.result] = (counts[b.result]||0)+1);

  if (resultsPieChart) resultsPieChart.destroy();
  resultsPieChart = new Chart(ctx, {
    type:"doughnut",
    data:{
      labels:["win","loss","pending","void"],
      datasets:[{
        data:[counts.win, counts.loss, counts.pending, counts.void],
        backgroundColor:(c)=> ringGradient(c, c.dataIndex),
        borderWidth:1, borderColor:"#0d1524"
      }]
    },
    options:{ plugins:{ legend:{ labels:{ color:"#e7eefc" } } }, cutout:"65%" },
    plugins:[donutShadow]
  });
}

/* -------- Calendar (with P/L in cells) -------- */
function drawCalendar(){
  const y = currentMonth.getFullYear();
  const m = currentMonth.getMonth();
  $("cal-title").textContent = currentMonth.toLocaleString(undefined, { month:"long", year:"numeric" });

  // Build per-day P&L and counts
  const sums = new Map();   // date -> pnl
  const counts = new Map(); // date -> bets
  allBets.forEach(b=>{
    const s = (sums.get(b.date)||0) + b.profit; sums.set(b.date, s);
    counts.set(b.date, (counts.get(b.date)||0) + 1);
  });

  const first = new Date(y, m, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const grid = $("calendar-grid");
  grid.innerHTML = "";

  for(let i=0;i<42;i++){
    const d = new Date(start); d.setDate(start.getDate()+i);
    const iso = d.toISOString().slice(0,10);
    const pnl = sums.get(iso) || 0;
    const has = counts.has(iso);

    const cell = document.createElement("div");
    cell.className = "cell" + (d.getMonth()!==m ? " out" : "") + (selectedCalendarISO===iso ? " active" : "");
    cell.title = has ? `${iso} — bets: ${counts.get(iso)}, P/L: ${euro(pnl)}` : `${iso} — no bets`;

    cell.innerHTML = `
      <div class="date-num">${d.getDate()}</div>
      ${has ? `<div class="amt ${pnl>0?'pos':pnl<0?'neg':''}">${euroShort(pnl)}</div>` : ""}
    `;

    cell.addEventListener("click", ()=>{
      selectedCalendarISO = (selectedCalendarISO===iso ? null : iso);
      filterDateISO = selectedCalendarISO; // also filters Overview ledger if you switch
      drawCalendar();
      updateDayBox();
    });

    grid.appendChild(cell);
  }
}

function updateDayBox(){
  const label = $("day-selected");
  const pill  = $("day-pnl");
  const tbody = $("day-tbody");
  tbody.innerHTML = "";

  if (!selectedCalendarISO){
    label.textContent = "—";
    pill.textContent = "€0";
    pill.classList.remove("profit-pos","profit-neg");
    return;
  }
  label.textContent = selectedCalendarISO;

  const rows = allBets.filter(b => b.date === selectedCalendarISO);
  const dayPnl = rows.reduce((s,b)=> s + b.profit, 0);
  pill.textContent = euro(dayPnl);
  pill.classList.remove("profit-pos","profit-neg");
  pill.classList.add(dayPnl>=0 ? "profit-pos" : "profit-neg");

  rows.forEach(b=>{
    const tr = document.createElement("tr");
    const cls = b.profit>=0 ? "profit-pos" : "profit-neg";
    tr.innerHTML = `
      <td>${b.sport}</td><td>${b.market}</td><td>${b.selection}</td>
      <td class="right">${b.odds.toFixed(2)}</td>
      <td class="right">€${b.stake.toFixed(2)}</td>
      <td class="right">${b.result}</td>
      <td class="right ${cls}">€${b.profit.toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* -------- ROI -------- */
function renderROI(){
  const settled = allBets.filter(b => b.result !== "pending" && b.result !== "void");
  const staked = settled.reduce((s,b)=> s + b.stake, 0);
  const profit = settled.reduce((s,b)=> s + b.profit, 0);
  const roi = staked ? (profit / staked) * 100 : 0;

  $("roi-overall").textContent = roi.toFixed(2) + "%";
  $("roi-settled").textContent = String(settled.length);
  $("roi-profit").textContent  = euro(profit);
  $("roi-stake").textContent   = euro(staked);

  const bySport = {};
  settled.forEach(b => {
    if (!bySport[b.sport]) bySport[b.sport] = { bets:0, stake:0, profit:0 };
    bySport[b.sport].bets += 1;
    bySport[b.sport].stake += b.stake;
    bySport[b.sport].profit += b.profit;
  });

  const tbody = $("roi-tbody");
  tbody.innerHTML = "";
  Object.entries(bySport).forEach(([sport, agg]) => {
    const roiPct = agg.stake ? (agg.profit / agg.stake) * 100 : 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${sport}</td>
      <td class="right">${agg.bets}</td>
      <td class="right">${euro(agg.stake)}</td>
      <td class="right ${agg.profit>=0?'profit-pos':'profit-neg'}">${euro(agg.profit)}</td>
      <td class="right ${roiPct>=0?'profit-pos':'profit-neg'}">${roiPct.toFixed(2)}%</td>
    `;
    tbody.appendChild(tr);
  });
}

/* -------- Utils -------- */
function groupByDateSum(items){
  const map = new Map();
  items.forEach(({date, pnl}) => map.set(date, (map.get(date)||0)+pnl));
  return Array.from(map.entries()).sort((a,b)=> a[0].localeCompare(b[0]))
    .map(([date,pnl]) => ({date, pnl}));
}
function computeMaxDrawdown(){
  const sorted = [...allBets].sort((a,b)=> a.date.localeCompare(b.date));
  let equity = bankrollStart, peak = bankrollStart, maxDD = 0;
  sorted.forEach(b => { equity += b.profit; peak = Math.max(peak,equity); const dd = peak - equity; if (dd>maxDD) maxDD = dd; });
  return maxDD;
}
