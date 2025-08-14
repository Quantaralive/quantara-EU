import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://bycktplwlfrdjxghajkg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5Y2t0cGx3bGZyZGp4Z2hhamtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUxNjM0MjEsImV4cCI6MjA3MDczOTQyMX0.ovDq1RLEEuOrTNeSek6-lvclXWmJfOz9DoHOv_L71iw";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ----- State ----- */
let bankrollStart = Number(localStorage.getItem("quantara_bankroll_start") || "10000");
let allBets = [];
let bankrollChart;

// ledger filters
let activeMonthKey = null;     // "YYYY-MM" or null for All
let filterDateISO = null;      // optional exact day filter (from calendar)

/* ----- Helpers ----- */
const $ = (id) => document.getElementById(id);
const q = (sel) => document.querySelector(sel);
const euro = (n) => new Intl.NumberFormat("it-IT",{style:"currency",currency:"EUR"}).format(n||0);
const euroShort = (n) => {
  const a = Math.abs(n), s = n<0?"-":"";
  return a>=1000 ? `${s}€${(a/1000).toFixed(1)}k` : `${s}€${a.toFixed(0)}`;
};
const emptyNull = (id) => { const v = ($(id).value||"").trim(); return v===""? null : v; };
const monthName = (ym) => { const [y,m]=ym.split("-"); return new Date(+y,+m-1,1).toLocaleString(undefined,{month:"long",year:"numeric"}); };

/* ----- Tabs minimal (only overview used here) ----- */
window.addEventListener("DOMContentLoaded", () => {
  // save bankroll
  $("bankroll-start").value = String(bankrollStart);
  $("save-bankroll").addEventListener("click", () => {
    const v = Number($("bankroll-start").value||"0");
    bankrollStart = isNaN(v) ? 10000 : v;
    localStorage.setItem("quantara_bankroll_start", String(bankrollStart));
    renderKPIs(); drawBankrollChart();
  });

  // auth (simple)
  $("signup").addEventListener("click", async () => {
    const email=($("email").value||"").trim(), password=($("password").value||"").trim();
    if(!email||!password) return alert("Enter email and password");
    const {error}=await supabase.auth.signUp({email,password}); if(error) return alert(error.message);
    alert("Account created. Now sign in.");
  });
  $("signin").addEventListener("click", async () => {
    const email=($("email").value||"").trim(), password=($("password").value||"").trim();
    if(!email||!password) return alert("Enter email and password");
    const {error}=await supabase.auth.signInWithPassword({email,password}); if(error) return alert(error.message);
    await loadData();
  });
  $("send-link").addEventListener("click", async () => {
    const email=($("email").value||"").trim(); if(!email) return alert("Enter your email");
    const redirect = window.location.origin + window.location.pathname.replace(/\/?$/, "/");
    const {error}=await supabase.auth.signInWithOtp({email, options:{ emailRedirectTo: redirect }}); 
    if(error) alert(error.message); else alert("Check your email.");
  });

  // add bet
  $("add-form").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const { data:{ user } } = await supabase.auth.getUser(); if(!user) return alert("Please sign in first.");
    const payload = {
      event_date: $("f-date").value ? new Date($("f-date").value).toISOString() : new Date().toISOString(),
      sport:$("f-sport").value||"Football",
      league:emptyNull("f-league"), market:emptyNull("f-market"), selection:emptyNull("f-selection"),
      odds:parseFloat($("f-odds").value||"1.8"), stake:parseFloat($("f-stake").value||"100"), result:$("f-result").value, notes:null
    };
    const {error}=await supabase.from("bets").insert(payload);
    if(error) return alert(error.message);
    e.target.reset();
    await loadData();
  });

  loadData();
});

/* ----- Data load ----- */
async function loadData(){
  const { data:{ session } } = await supabase.auth.getSession();
  if(!session){ q(".container").style.display="none"; $("signout").style.display="none"; return; }
  $("signout").style.display="inline-block"; q(".container").style.display="block";
  await supabase.from("profiles").upsert({ id: session.user.id });

  const { data, error } = await supabase.from("bets_enriched").select("*").order("event_date",{ascending:true});
  if(error){ alert(error.message); return; }

  allBets = (data||[]).map(r => ({
    id:r.id,
    date:(r.event_date||"").slice(0,10), // YYYY-MM-DD
    sport:r.sport||"", league:r.league||"", market:r.market||"", selection:r.selection||"",
    odds:Number(r.odds)||0, stake:Number(r.stake)||0, result:r.result,
    profit: r.result==="win" ? (Number(r.odds)-1)*Number(r.stake) : r.result==="loss" ? -Number(r.stake) : 0
  }));

  renderKPIs();
  drawBankrollChart();
  buildMonthTabs();   // <<< build the month tabs
  renderLedger();     // <<< draw the table
}

/* ----- KPIs & bankroll chart (simple) ----- */
function renderKPIs(){
  const stake=allBets.reduce((s,b)=>s+b.stake,0);
  const profit=allBets.reduce((s,b)=>s+b.profit,0);
  const settled=allBets.filter(b=>b.result!=="pending");
  const win = settled.length ? (settled.filter(b=>b.result==="win").length/settled.length*100) : 0;
  $("bankroll").textContent = euro(bankrollStart + profit);
  $("staked").textContent = euro(stake);
  $("winrate").textContent = win.toFixed(1)+"%";
}
function drawBankrollChart(){
  const ctx=$("bankrollChart").getContext("2d");
  const sorted=[...allBets].sort((a,b)=>a.date.localeCompare(b.date));
  let eq=bankrollStart; const labels=[], data=[];
  sorted.forEach(b=>{ eq+=b.profit; labels.push(b.date); data.push(Number(eq.toFixed(2))); });
  if(window._bankroll){ window._bankroll.destroy(); }
  window._bankroll = new Chart(ctx,{ type:"line", data:{labels, datasets:[{label:"Bankroll (€)", data, tension:.35, borderWidth:2, pointRadius:0}]}, options:{ plugins:{legend:{display:false}} }});
}

/* ===================== MONTH TABS ===================== */
function buildMonthTabs(){
  const wrap = $("month-tabs");
  wrap.innerHTML = "";

  // group by YYYY-MM
  const groups = {};
  allBets.forEach(b=>{
    const key = b.date.slice(0,7);
    if(!groups[key]) groups[key]={ pnl:0, count:0 };
    groups[key].pnl += b.profit; groups[key].count += 1;
  });

  // "All" tab first
  const totalPnL = allBets.reduce((s,b)=> s+b.profit, 0);
  const allBtn = document.createElement("button");
  allBtn.className = "month-tab" + (activeMonthKey===null?" active":"");
  allBtn.innerHTML = `<span>All</span><span class="month-pill ${totalPnL>=0?"pos":"neg"}">${euroShort(totalPnL)}</span>`;
  allBtn.addEventListener("click", ()=>{ activeMonthKey=null; filterDateISO=null; renderLedger(); buildMonthTabs(); });
  wrap.appendChild(allBtn);

  // Each month (newest first)
  Object.keys(groups).sort().reverse().forEach(key=>{
    const pnl = groups[key].pnl;
    const btn = document.createElement("button");
    btn.className = "month-tab" + (activeMonthKey===key?" active":"");
    btn.innerHTML = `<span>${monthName(key)}</span><span class="month-pill ${pnl>=0?"pos":"neg"}">${euroShort(pnl)}</span>`;
    btn.addEventListener("click", ()=>{
      activeMonthKey = (activeMonthKey===key ? null : key);
      filterDateISO = null;        // clear any day filter
      renderLedger();
      buildMonthTabs();
    });
    wrap.appendChild(btn);
  });
}

/* Render the ledger table according to activeMonthKey or filterDateISO */
function renderLedger(){
  const tbody = q("#ledger tbody");
  tbody.innerHTML = "";

  // choose filter: month first, else specific day, else all
  let rows = allBets;
  if (activeMonthKey) rows = rows.filter(b => b.date.startsWith(activeMonthKey));
  else if (filterDateISO) rows = rows.filter(b => b.date === filterDateISO);

  rows.forEach(b=>{
    const tr=document.createElement("tr");
    const cls=b.profit>=0?"profit-pos":"profit-neg";
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
