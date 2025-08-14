// app.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://bycktplwlfrdjxghajkg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5Y2t0cGx3bGZyZGp4Z2hhamtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUxNjM0MjEsImV4cCI6MjA3MDczOTQyMX0.ovDq1RLEEuOrTNeSek6-lvclXWmJfOz9DoHOv_L71iw";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// UI refs
const emailInput  = () => document.getElementById("email");
const passInput   = () => document.getElementById("password");
const signupBtn   = () => document.getElementById("signup");
const signinBtn   = () => document.getElementById("signin");
const linkBtn     = () => document.getElementById("send-link");
const signoutBtn  = () => document.getElementById("signout");
const dashboard   = () => document.querySelector(".container");
const bankrollEl  = () => document.getElementById("bankroll");
const stakedEl    = () => document.getElementById("staked");
const winrateEl   = () => document.getElementById("winrate");
const ledgerBody  = () => document.querySelector("#ledger tbody");

// Calendar refs
const calTitle = () => document.getElementById("cal-title");
const calGrid  = () => document.getElementById("calendar-grid");
const calPrev  = () => document.getElementById("cal-prev");
const calNext  = () => document.getElementById("cal-next");
const clearFilterBtn = () => document.getElementById("clear-filter");

let bankrollStart = 10000;
let bankrollChart, stakeChart;
let allBets = [];
let filterDateISO = null; // YYYY-MM-DD for calendar filter
let currentMonth = new Date();

window.addEventListener("DOMContentLoaded", () => {
  // Hide dashboard until logged in
  dashboard().style.display = "none";

  // Auth handlers
  signupBtn().addEventListener("click", async () => {
    const email = (emailInput().value || "").trim();
    const password = (passInput().value || "").trim();
    if (!email || !password) return alert("Enter email and password");
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) return alert(error.message);
    alert("Account created. Now click 'Sign in'.");
  });

  signinBtn().addEventListener("click", async () => {
    const email = (emailInput().value || "").trim();
    const password = (passInput().value || "").trim();
    if (!email || !password) return alert("Enter email and password");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return alert(error.message);
    await render();
  });

  linkBtn().addEventListener("click", async () => {
    const email = (emailInput().value || "").trim();
    if (!email) return alert("Enter your email");
    const redirect = window.location.origin + window.location.pathname.replace(/\/?$/, "/");
    const { error } = await supabase.auth.signInWithOtp({ email, options:{ emailRedirectTo: redirect }});
    if (error) alert(error.message); else alert("Check your email for the magic link.");
  });

  signoutBtn().addEventListener("click", async () => {
    await supabase.auth.signOut();
    dashboard().style.display = "none";
    signoutBtn().style.display = "none";
  });

  // Add bet (RLS FIX: include user_id = auth.uid())
  document.getElementById("add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return alert("Please sign in first.");
    const payload = {
      user_id: user.id, // <-- RLS requirement
      event_date: document.getElementById("f-date").value
        ? new Date(document.getElementById("f-date").value).toISOString()
        : new Date().toISOString(),
      sport:     document.getElementById("f-sport").value || "Football",
      league:    emptyNull("f-league"),
      market:    emptyNull("f-market"),
      selection: emptyNull("f-selection"),
      odds:  parseFloat(document.getElementById("f-odds").value  || "1.80"),
      stake: parseFloat(document.getElementById("f-stake").value || "100"),
      result: document.getElementById("f-result").value,
      notes: null
    };
    const { error } = await supabase.from("bets").insert(payload);
    if (error) return alert(error.message);
    e.target.reset();
    await render(); // refresh data/UI
  });

  // Calendar controls
  calPrev().addEventListener("click", () => { currentMonth.setMonth(currentMonth.getMonth()-1); drawCalendar(); });
  calNext().addEventListener("click", () => { currentMonth.setMonth(currentMonth.getMonth()+1); drawCalendar(); });
  clearFilterBtn().addEventListener("click", () => { filterDateISO = null; drawCalendar(); renderLedger(); });

  // Initial render
  render();
});

function emptyNull(id){ const v = (document.getElementById(id).value || "").trim(); return v===""? null : v; }

async function render(){
  const { data:{ session } } = await supabase.auth.getSession();
  if(!session){
    dashboard().style.display = "none";
    signoutBtn().style.display = "none";
    return;
  }
  signoutBtn().style.display = "inline-block";
  dashboard().style.display = "block";

  await supabase.from("profiles").upsert({ id: session.user.id });

  // Load bets
  const { data, error } = await supabase
    .from("bets_enriched")
    .select("*")
    .order("event_date", { ascending:true });

  if(error){ alert(error.message); return; }

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

  // KPIs
  const totalStake = allBets.reduce((s,b)=> s + b.stake, 0);
  const totalProfit = allBets.reduce((s,b)=> s + b.profit, 0);
  const settled = allBets.filter(b => b.result!=="pending");
  const winRate = settled.length ? (settled.filter(b=>b.result==="win").length / settled.length * 100) : 0;

  bankrollEl().textContent = euro(bankrollStart + totalProfit);
  stakedEl().textContent   = euro(totalStake);
  winrateEl().textContent  = winRate.toFixed(1) + "%";

  // Charts
  drawBankrollChart();
  drawStakeChart();

  // Calendar + ledger
  drawCalendar();
  renderLedger();
}

function renderLedger(){
  const tbody = ledgerBody();
  tbody.innerHTML = "";
  const rows = (filterDateISO)
    ? allBets.filter(b => b.date === filterDateISO)
    : allBets;

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

/* ---------- Charts ---------- */
function drawBankrollChart(){
  const ctx = document.getElementById("bankrollChart").getContext("2d");
  const sorted = [...allBets].sort((a,b)=> a.date.localeCompare(b.date));
  let cum = bankrollStart;
  const labels = [];
  const data = [];
  sorted.forEach(b=>{
    cum += b.profit;
    labels.push(b.date);
    data.push(Number(cum.toFixed(2)));
  });
  if(bankrollChart) bankrollChart.destroy();
  bankrollChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Bankroll (€)",
        data,
        tension: 0.35,
        borderWidth: 2,
        pointRadius: 0
      }]
    },
    options: {
      responsive:true,
      plugins:{ legend:{ display:false } },
      scales:{
        x:{ ticks:{ color:"#93a0b7" }, grid:{ color:"rgba(147,160,183,0.1)" } },
        y:{ ticks:{ color:"#93a0b7" }, grid:{ color:"rgba(147,160,183,0.1)" } }
      }
    }
  });
}

function drawStakeChart(){
  const ctx = document.getElementById("stakeChart").getContext("2d");
  const bySport = {};
  allBets.forEach(b => { bySport[b.sport] = (bySport[b.sport] || 0) + b.stake; });
  const labels = Object.keys(bySport);
  const values = Object.values(bySport);
  if(stakeChart) stakeChart.destroy();
  stakeChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data: values }]
    },
    options: {
      plugins:{ legend:{ labels:{ color:"#e7eefc" } } },
      cutout: "60%"
    }
  });
}

/* ---------- Calendar ---------- */
function drawCalendar(){
  const y = currentMonth.getFullYear();
  const m = currentMonth.getMonth();
  calTitle().textContent = currentMonth.toLocaleString(undefined, { month:"long", year:"numeric" });

  // Collect dates with bets
  const hasBet = new Set(allBets.map(b=> b.date));

  // Build grid (Sun..Sat)
  const first = new Date(y, m, 1);
  const startDay = new Date(first);
  startDay.setDate(first.getDate() - first.getDay()); // start from Sunday
  calGrid().innerHTML = "";

  for(let i=0;i<42;i++){
    const d = new Date(startDay); d.setDate(startDay.getDate()+i);
    const dISO = d.toISOString().slice(0,10);
    const cell = document.createElement("div");
    cell.className = "cell" + (d.getMonth()!==m ? " out" : "") + (hasBet.has(dISO) ? " mark" : "") + (filterDateISO===dISO ? " active" : "");
    cell.textContent = d.getDate();
    cell.style.position = "relative";
    cell.addEventListener("click", ()=>{
      filterDateISO = dISO === filterDateISO ? null : dISO;
      drawCalendar();
      renderLedger();
    });
    calGrid().appendChild(cell);
  }
}

/* ---------- Helpers ---------- */
function euro(n){ return new Intl.NumberFormat("it-IT",{style:"currency",currency:"EUR"}).format(n||0); }
