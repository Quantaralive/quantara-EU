// app.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://bycktplwlfrdjxghajkg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5Y2t0cGx3bGZyZGp4Z2hhamtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUxNjM0MjEsImV4cCI6MjA3MDczOTQyMX0.ovDq1RLEEuOrTNeSek6-lvclXWmJfOz9DoHOv_L71iw";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- State ---
let bankrollStart = Number(localStorage.getItem("quantara_bankroll_start") || "10000");
let allBets = [];
let bankrollChart, stakeChart;
let filterDateISO = null;
let currentMonth = new Date();

// --- Refs ---
const $ = (id) => document.getElementById(id);
const q = (sel) => document.querySelector(sel);

// --- Auth handlers ---
window.addEventListener("DOMContentLoaded", () => {
  // Prefill bankroll start
  $("bankroll-start").value = String(bankrollStart);

  $("save-bankroll").addEventListener("click", () => {
    const v = Number($("bankroll-start").value || "0");
    bankrollStart = isNaN(v) ? 10000 : v;
    localStorage.setItem("quantara_bankroll_start", String(bankrollStart));
    renderKPIsAndCharts();
  });

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

  // Add bet (omit user_id — DB fills it with auth.uid() per Step 0)
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
    await render(); // reload data
  });

  // Calendar controls
  $("cal-prev").addEventListener("click", () => { currentMonth.setMonth(currentMonth.getMonth()-1); drawCalendar(); });
  $("cal-next").addEventListener("click", () => { currentMonth.setMonth(currentMonth.getMonth()+1); drawCalendar(); });
  $("clear-filter").addEventListener("click", () => { filterDateISO = null; drawCalendar(); renderLedger(); });

  render();
});

// --- Render all ---
async function render(){
  const { data:{ session } } = await supabase.auth.getSession();
  if (!session) {
    q(".container").style.display = "none";
    $("signout").style.display = "none";
    return;
  }

  $("signout").style.display = "inline-block";
  q(".container").style.display = "block";

  // Ensure profile exists
  await supabase.from("profiles").upsert({ id: session.user.id });

  // Load bets
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

  renderKPIsAndCharts();
  drawCalendar();
  renderLedger();
}

function renderKPIsAndCharts(){
  // KPIs
  const totalStake = allBets.reduce((s,b)=> s + b.stake, 0);
  const totalProfit = allBets.reduce((s,b)=> s + b.profit, 0);
  const settled = allBets.filter(b => b.result !== "pending");
  const winRate = settled.length ? (settled.filter(b=>b.result==="win").length / settled.length * 100) : 0;

  $("bankroll").textContent = euro(bankrollStart + totalProfit);
  $("staked").textContent   = euro(totalStake);
  $("winrate").textContent  = winRate.toFixed(1) + "%";

  // Charts
  drawBankrollChart(bankrollStart);
  drawStakeChart();
}

function renderLedger(){
  const tbody = q("#ledger tbody");
  tbody.innerHTML = "";
  const rows = filterDateISO ? allBets.filter(b => b.date === filterDateISO) : allBets;

  rows.forEach(b => {
    const tr = document.createElement("tr");
    const profitClass = b.profit>=0 ? "profit-pos" : "profit-neg";
    tr.innerHTML = `
      <td>${b.date}</td>
      <td>${b.sport}</td>
      <td>${b.league}</td>
      <td>${b.market}</td>
      <td>${b.selection}</td>
      <td class="right">${b.odds.toFixed(2)}</td>
      <td class="right">€${b.stake.toFixed(2)}</td>
      <td class="right">${b.result}</td>
      <td class="right ${profitClass}">€${b.profit.toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* -------- Charts -------- */
function drawBankrollChart(start){
  const ctx = $("bankrollChart").getContext("2d");
  const sorted = [...allBets].sort((a,b)=> a.date.localeCompare(b.date));
  let cum = start;
  const labels = [];
  const data = [];
  sorted.forEach(b=>{
    cum += b.profit;
    labels.push(b.date);
    data.push(Number(cum.toFixed(2)));
  });
  if (bankrollChart) bankrollChart.destroy();
  bankrollChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [{ label:"Bankroll (€)", data, tension:.35, borderWidth:2, pointRadius:0 }] },
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

function drawStakeChart(){
  const ctx = $("stakeChart").getContext("2d");
  const bySport = {};
  allBets.forEach(b => { bySport[b.sport] = (bySport[b.sport] || 0) + b.stake; });
  const labels = Object.keys(bySport);
  const values = Object.values(bySport);
  if (stakeChart) stakeChart.destroy();
  stakeChart = new Chart(ctx, {
    type: "doughnut",
    data: { labels, datasets: [{ data: values }] },
    options: { plugins:{ legend:{ labels:{ color:"#e7eefc" } } }, cutout:"60%" }
  });
}

/* -------- Calendar -------- */
function drawCalendar(){
  const y = currentMonth.getFullYear();
  const m = currentMonth.getMonth();
  $("cal-title").textContent = currentMonth.toLocaleString(undefined, { month:"long", year:"numeric" });

  const hasBet = new Set(allBets.map(b=> b.date));

  const first = new Date(y, m, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const grid = $("calendar-grid");
  grid.innerHTML = "";

  for(let i=0;i<42;i++){
    const d = new Date(start); d.setDate(start.getDate()+i);
    const iso = d.toISOString().slice(0,10);
    const cell = document.createElement("div");
    cell.className = "cell" + (d.getMonth()!==m ? " out" : "") + (hasBet.has(iso) ? " mark" : "") + (filterDateISO===iso ? " active" : "");
    cell.textContent = d.getDate();
    cell.addEventListener("click", ()=>{ filterDateISO = (filterDateISO===iso? null : iso); drawCalendar(); renderLedger(); });
    grid.appendChild(cell);
  }
}

/* -------- Helpers -------- */
function euro(n){ return new Intl.NumberFormat("it-IT",{style:"currency",currency:"EUR"}).format(n||0); }
function emptyNull(id){ const v = ($(id).value || "").trim(); return v===""? null : v; }
