"use strict";

/* Supabase */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://bycktplwlfrdjxghajkg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5Y2t0cGx3bGZyZGp4Z2hhamtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUxNjM0MjEsImV4cCI6MjA3MDczOTQyMX0.ovDq1RLEEuOrTNeSek6-lvclXWmJfOz9DoHOv_L71iw";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
console.log("Quantara app v6 — multi-bankroll");

/* State */
let bankrolls = [];
let allBets = [];
let activeBankrollId = localStorage.getItem("quantara_active_bankroll_id") || null;

let bankrollChart = null, analyticsStakeChart = null, pnlBarChart = null,
    oddsHistChart = null, resultsPieChart = null, pnlMonthChart = null, winRateBySportChart = null;

let activeMonthKey = null, filterDateISO = null, selectedCalendarISO = null;
let currentMonth = new Date();
let editingId = null;

/* Helpers */
const $ = (id)=>document.getElementById(id);
const q = (sel)=>document.querySelector(sel);
const euro=(n)=>new Intl.NumberFormat("it-IT",{style:"currency",currency:"EUR"}).format(Number(n||0));
function euroShort(n){ const v=Number(n||0), s=v<0?"-":"", a=Math.abs(v); return a>=1000 ? s+"€"+(a/1000).toFixed(1)+"k" : s+"€"+a.toFixed(0); }
function emptyNull(id){ const el=$(id); const v=el?String(el.value||"").trim():""; return v===""?null:v; }
function monthName(ym){ const p=ym.split("-"); const d=new Date(Number(p[0]), Number(p[1])-1, 1); return d.toLocaleString(undefined,{month:"long",year:"numeric"}); }
function median(arr){ const a=arr.slice().sort((x,y)=>x-y); if(!a.length) return 0; const m=Math.floor(a.length/2); return a.length%2?a[m]:(a[m-1]+a[m])/2; }
const baseOpts = ()=>({ responsive:true, maintainAspectRatio:false, resizeDelay:200 });

/* Tab routing */
function setTab(tab){
  const panes={home:$("tab-home"),overview:$("tab-overview"),analytics:$("tab-analytics"),roi:$("tab-roi"),calendar:$("tab-calendar")};
  const btns ={home:$("tab-btn-home"),overview:$("tab-btn-overview"),analytics:$("tab-btn-analytics"),roi:$("tab-btn-roi"),calendar:$("tab-btn-calendar")};
  Object.values(panes).forEach(p=>p.classList.add("hidden"));
  Object.values(btns).forEach(b=>b.classList.remove("active"));
  panes[tab].classList.remove("hidden");
  btns[tab].classList.add("active");
  if(tab==="home") renderHome();
  if(tab==="analytics") renderAnalytics();
  if(tab==="roi") renderROI();
  if(tab==="calendar"){ drawCalendar(); updateDayBox(); }
}

/* Expose reliable navigation as inline handlers */
window.__go = function(tab){
  const needActive = (t)=>["overview","analytics","roi","calendar"].includes(t);
  if(needActive(tab) && !getActive()){
    alert("Select or create a bankroll on Home first.");
    setTab("home");
    openBkModal(); // helpful prompt
    return;
  }
  setTab(tab);
};
window.__openBkModal = ()=>openBkModal();
window.__clearActive = ()=>{
  activeBankrollId = null;
  localStorage.removeItem("quantara_active_bankroll_id");
  setTab("home"); render();
};

/* Utils re bankroll */
function getActive(){ return bankrolls.find(b=>b.id===activeBankrollId) || null; }
function currentBets(){ return allBets.filter(b=>b.bankroll_id === activeBankrollId); }

/* Startup */
window.addEventListener("DOMContentLoaded", function(){
  // Still attach listeners (nice for keyboard users), but inline exists too
  $("tab-btn-home")?.addEventListener("click", ()=>window.__go("home"));
  $("tab-btn-overview")?.addEventListener("click", ()=>window.__go("overview"));
  $("tab-btn-analytics")?.addEventListener("click", ()=>window.__go("analytics"));
  $("tab-btn-roi")?.addEventListener("click", ()=>window.__go("roi"));
  $("tab-btn-calendar")?.addEventListener("click", ()=>window.__go("calendar"));

  $("signup").addEventListener("click", signup);
  $("signin").addEventListener("click", signin);
  $("send-link").addEventListener("click", sendMagic);
  $("signout").addEventListener("click", signout);

  // Also wire the modal buttons (in case inline fails)
  $("btn-new-bankroll")?.addEventListener("click", openBkModal);
  $("bk-close").addEventListener("click", closeBkModal);
  $("bk-cancel").addEventListener("click", closeBkModal);
  $("bk-form").addEventListener("submit", createBankroll);
  $("btn-clear-active")?.addEventListener("click", window.__clearActive);

  $("save-bankroll").addEventListener("click", saveBankrollStart);

  // Add bet (to active bankroll)
  $("add-form").addEventListener("submit", addBetSubmit);

  // Edit bet modal
  $("edit-close").addEventListener("click", closeEdit);
  $("edit-cancel").addEventListener("click", closeEdit);
  $("edit-form").addEventListener("submit", onEditSubmit);

  // Calendar controls
  $("cal-prev").addEventListener("click", ()=>{ currentMonth.setMonth(currentMonth.getMonth()-1); drawCalendar(); });
  $("cal-next").addEventListener("click", ()=>{ currentMonth.setMonth(currentMonth.getMonth()+1); drawCalendar(); });
  $("clear-filter").addEventListener("click", ()=>{ selectedCalendarISO=null; filterDateISO=null; drawCalendar(); updateDayBox(); });

  // Global handlers for action buttons
  window.__edit = (id)=>openEdit(id);
  window.__del  = (id)=>deleteBet(id);
  window.__openBk = (id)=>selectBankroll(id);
  window.__renameBk = (id)=>renameBankroll(id);
  window.__deleteBk = (id)=>deleteBankroll(id);

  render();
});

/* Auth */
async function signup(){
  const email=String($("email").value||"").trim();
  const password=String($("password").value||"").trim();
  if(!email||!password){ alert("Enter email and password"); return; }
  const out=await supabase.auth.signUp({ email,password });
  if(out.error){ alert(out.error.message); return; }
  alert("Account created. Now click Sign in.");
}
async function signin(){
  const email=String($("email").value||"").trim();
  const password=String($("password").value||"").trim();
  if(!email||!password){ alert("Enter email and password"); return; }
  const out=await supabase.auth.signInWithPassword({ email,password });
  if(out.error){ alert(out.error.message); return; }
  await render();
}
async function sendMagic(){
  const email=String($("email").value||"").trim();
  if(!email){ alert("Enter your email"); return; }
  const redirect=window.location.origin + window.location.pathname.replace(/\/?$/,"/");
  const out=await supabase.auth.signInWithOtp({ email, options:{ emailRedirectTo:redirect } });
  if(out.error){ alert(out.error.message); } else { alert("Check your email."); }
}
async function signout(){
  await supabase.auth.signOut();
  q(".container").style.display="none";
  $("signout").style.display="none";
}

/* Data loaders */
async function loadBankrolls(){
  const sess=await supabase.auth.getSession(); const session=sess?.data?.session;
  if(!session){ bankrolls=[]; return; }
  const r = await supabase.from("bankrolls").select("*").order("created_at",{ascending:true});
  if(r.error){ alert(r.error.message); return; }
  bankrolls = r.data || [];
  // If no selection, or selection missing, pick first
  if(!activeBankrollId || !bankrolls.find(b=>b.id===activeBankrollId)){
    activeBankrollId = bankrolls[0]?.id || null;
    if(activeBankrollId) localStorage.setItem("quantara_active_bankroll_id", activeBankrollId);
    else localStorage.removeItem("quantara_active_bankroll_id");
  }
}

async function loadBets(){
  const r = await supabase
    .from("bets")
    .select("id,bankroll_id,event_date,sport,league,market,selection,odds,stake,result")
    .order("event_date",{ascending:true});
  if(r.error){ alert(r.error.message); return; }
  allBets = (r.data||[]).map(x=>{
    let pr=0; if(x.result==="win") pr=(Number(x.odds)-1)*Number(x.stake);
    else if(x.result==="loss") pr=-Number(x.stake);
    return { ...x, date:String(x.event_date||"").slice(0,10), profit:pr };
  });
}

/* Main render */
async function render(){
  const sess=await supabase.auth.getSession();
  const session=sess && sess.data ? sess.data.session : null;
  if(!session){
    q(".container").style.display="none";
    $("signout").style.display="none";
    return;
  }
  $("signout").style.display="inline-block";
  q(".container").style.display="block";

  await supabase.from("profiles").upsert({ id: session.user.id });

  await loadBankrolls();
  await loadBets();
  await renderAfterData();
}

async function renderAfterData(){
  renderHome();

  const active = getActive();
  if(!active){
    setTab("home");
    return;
  }

  $("bk-name-inline").textContent = active.name;
  $("bk-name-inline-2").textContent = active.name;
  $("bankroll-start").value = String(active.start_amount || 0);

  renderKPIs();
  drawBankrollChart();
  buildMonthTabs();
  renderLedger();

  if(!$("tab-analytics").classList.contains("hidden")) renderAnalytics();
  if(!$("tab-roi").classList.contains("hidden")) renderROI();
  if(!$("tab-calendar").classList.contains("hidden")){ drawCalendar(); updateDayBox(); }
}

/* HOME */
function renderHome(){
  const cur = getActive();
  $("current-bk").textContent = cur ? `${cur.name} — ${euro(cur.start_amount)}` : "None selected";

  const grid = $("bankroll-grid");
  grid.innerHTML = "";
  const totals = new Map(); // bankroll_id -> {pnl, count}
  allBets.forEach(b=>{
    const t = totals.get(b.bankroll_id) || { pnl:0, count:0 };
    t.pnl += b.profit; t.count += 1; totals.set(b.bankroll_id, t);
  });

  bankrolls.forEach(b=>{
    const t = totals.get(b.id) || { pnl:0, count:0 };
    const equity = Number(b.start_amount) + t.pnl;
    const card = document.createElement("div");
    card.className = "bankroll-card";
    card.innerHTML =
      `<div class="bankroll-row">
         <div>
           <div class="bankroll-title">${b.name}</div>
           <div class="bankroll-sub">Start: ${euro(b.start_amount)} · Bets: ${t.count}</div>
         </div>
         <div class="bk-pill ${equity>=b.start_amount?'profit-pos':'profit-neg'}">${euro(equity)}</div>
       </div>
       <div class="bankroll-actions">
         <button class="btn btn-primary" onclick='window.__openBk(${JSON.stringify(b.id)})'>Open</button>
         <button class="btn" onclick='window.__renameBk(${JSON.stringify(b.id)})'>Rename</button>
         <button class="btn" onclick='window.__deleteBk(${JSON.stringify(b.id)})'>Delete</button>
       </div>`;
    grid.appendChild(card);
  });
}

function openBkModal(){ $("bk-modal").classList.remove("hidden"); }
function closeBkModal(){ $("bk-modal").classList.add("hidden"); $("bk-form").reset(); }

async function createBankroll(e){
  e.preventDefault();
  const name = String($("bk-name").value || "").trim();
  const start = Number($("bk-start").value || "0");
  if(!name){ alert("Give your bankroll a name"); return; }
  const sess=await supabase.auth.getSession(); const uid=sess?.data?.session?.user?.id;
  const ins = await supabase.from("bankrolls").insert({ name, start_amount: isNaN(start)?0:start, user_id: uid }).select("*").single();
  if(ins.error){ alert(ins.error.message); return; }
  closeBkModal();
  await loadBankrolls();
  activeBankrollId = ins.data.id;
  localStorage.setItem("quantara_active_bankroll_id", activeBankrollId);
  setTab("overview");
  await loadBets();
  await renderAfterData();
}

async function selectBankroll(id){
  activeBankrollId = id;
  localStorage.setItem("quantara_active_bankroll_id", id);
  setTab("overview");
  await renderAfterData();
}
async function renameBankroll(id){
  const b = bankrolls.find(x=>x.id===id); if(!b) return;
  const name = prompt("New name for bankroll:", b.name);
  if(!name) return;
  const u = await supabase.from("bankrolls").update({ name }).eq("id", id);
  if(u.error){ alert(u.error.message); return; }
  await loadBankrolls(); await renderAfterData();
}
async function deleteBankroll(id){
  if(!confirm("Delete this bankroll? Bets will remain but lose the link.")) return;
  const d = await supabase.from("bankrolls").delete().eq("id", id);
  if(d.error){ alert(d.error.message); return; }
  if(activeBankrollId===id){ activeBankrollId=null; localStorage.removeItem("quantara_active_bankroll_id"); }
  await loadBankrolls(); await renderAfterData();
}

async function saveBankrollStart(){
  const active = getActive(); if(!active){ alert("Pick a bankroll first on Home."); return; }
  const v=Number($("bankroll-start").value || "0");
  const upd=await supabase.from("bankrolls").update({ start_amount: isNaN(v)?0:v }).eq("id", active.id);
  if(upd.error){ alert(upd.error.message); return; }
  await loadBankrolls(); renderKPIs(); drawBankrollChart(); if(!$("tab-analytics").classList.contains("hidden")) renderAnalytics();
}

async function addBetSubmit(e){
  e.preventDefault();
  const active = getActive();
  if(!active){ alert("Select a bankroll first on Home."); return; }
  const u=await supabase.auth.getUser(); const user=u&&u.data?u.data.user:null;
  if(!user){ alert("Please sign in first."); return; }
  const payload={
    bankroll_id: active.id,
    event_date:$("f-date").value?new Date($("f-date").value).toISOString():new Date().toISOString(),
    sport:$("f-sport").value||"Football",
    league: emptyNull("f-league"),
    market: emptyNull("f-market"),
    selection: emptyNull("f-selection"),
    odds: parseFloat($("f-odds").value||"1.80"),
    stake: parseFloat($("f-stake").value||"100"),
    result:$("f-result").value,
    notes:null
  };
  const ins=await supabase.from("bets").insert(payload);
  if(ins.error){ alert("Insert failed: "+ins.error.message); return; }
  e.target.reset();
  await loadBets();
  await renderAfterData();
}

/* KPIs / Ledger */
function renderKPIs(){
  const rows = currentBets();
  const stake = rows.reduce((s,b)=>s+b.stake,0);
  const profit = rows.reduce((s,b)=>s+b.profit,0);
  const settled = rows.filter(b=>b.result!=="pending");
  const wins = settled.filter(b=>b.result==="win").length;
  const winRate = settled.length ? (wins/settled.length)*100 : 0;

  const startAmt = getActive()?.start_amount || 0;
  $("bankroll").textContent = euro(startAmt + profit);
  $("staked").textContent = euro(stake);
  $("winrate").textContent = winRate.toFixed(1)+"%";
}

function buildMonthTabs(){
  const wrap=$("month-tabs"); wrap.innerHTML="";
  const rows = currentBets();

  const groups=new Map(); rows.forEach(b=>{ const k=b.date.slice(0,7); groups.set(k,(groups.get(k)||0)+b.profit); });
  const totalPnL=rows.reduce((s,b)=>s+b.profit,0);

  const allBtn=document.createElement("button");
  allBtn.className="month-tab"+(activeMonthKey===null?" active":"");
  allBtn.innerHTML="<span>All</span><span class=\"month-pill "+(totalPnL>=0?"pos":"neg")+"\">"+euroShort(totalPnL)+"</span>";
  allBtn.addEventListener("click",()=>{ activeMonthKey=null; filterDateISO=null; renderLedger(); buildMonthTabs(); });
  wrap.appendChild(allBtn);

  Array.from(groups.keys()).sort().reverse().forEach(ym=>{
    const pnl=groups.get(ym)||0;
    const btn=document.createElement("button");
    btn.className="month-tab"+(activeMonthKey===ym?" active":"");
    btn.innerHTML="<span>"+monthName(ym)+"</span><span class=\"month-pill "+(pnl>=0?"pos":"neg")+"\">"+euroShort(pnl)+"</span>";
    btn.addEventListener("click",()=>{ activeMonthKey=(activeMonthKey===ym?null:ym); filterDateISO=null; renderLedger(); buildMonthTabs(); });
    wrap.appendChild(btn);
  });
}

function renderLedger(){
  const tbody=q("#ledger tbody"); tbody.innerHTML="";
  let rows=currentBets().slice();
  if(activeMonthKey){ rows=rows.filter(b=>b.date.indexOf(activeMonthKey)===0); }
  else if(filterDateISO){ rows=rows.filter(b=>b.date===filterDateISO); }

  rows.forEach(b=>{
    const tr=document.createElement("tr");
    const cls=b.profit>=0?"profit-pos":"profit-neg";
    tr.innerHTML =
      "<td>"+b.date+"</td><td>"+b.sport+"</td><td>"+b.league+"</td><td>"+b.market+"</td>"+
      "<td>"+b.selection+"</td><td class='right'>"+b.odds.toFixed(2)+"</td>"+
      "<td class='right'>€"+b.stake.toFixed(2)+"</td><td class='right'>"+b.result+"</td>"+
      "<td class='right "+cls+"'>€"+b.profit.toFixed(2)+"</td>"+
      "<td class='right actions'>"+
        "<button class='action-btn action-edit' onclick='window.__edit("+JSON.stringify(b.id)+")'>Edit</button>"+
        "<button class='action-btn action-del'  onclick='window.__del("+JSON.stringify(b.id)+")'>Delete</button>"+
      "</td>";
    tbody.appendChild(tr);
  });
}

/* Edit / Delete bet */
function openEdit(id){
  const b=allBets.find(x=>String(x.id)===String(id));
  if(!b){ alert("Bet not found"); return; }
  editingId=b.id;
  $("e-id").value=String(b.id);
  $("e-date").value=b.date;
  $("e-sport").value=b.sport;
  $("e-league").value=b.league;
  $("e-market").value=b.market;
  $("e-selection").value=b.selection;
  $("e-odds").value=String(b.odds);
  $("e-stake").value=String(b.stake);
  $("e-result").value=b.result;
  $("edit-modal").classList.remove("hidden");
}
function closeEdit(){ $("edit-modal").classList.add("hidden"); editingId=null; }
async function onEditSubmit(e){
  e.preventDefault();
  if(!editingId){ closeEdit(); return; }
  const payload={
    event_date:$("e-date").value?new Date($("e-date").value).toISOString():new Date().toISOString(),
    sport:$("e-sport").value||"Football",
    league: emptyNull("e-league"),
    market: emptyNull("e-market"),
    selection: emptyNull("e-selection"),
    odds: parseFloat($("e-odds").value||"1.80"),
    stake: parseFloat($("e-stake").value||"100"),
    result:$("e-result").value
  };
  const upd=await supabase.from("bets").update(payload).eq("id", editingId);
  if(upd.error){ alert("Update failed: "+upd.error.message); return; }
  closeEdit();
  await loadBets();
  await renderAfterData();
}
async function deleteBet(id){
  if(!confirm("Delete this bet?")) return;
  const del=await supabase.from("bets").delete().eq("id", id);
  if(del.error){ alert("Delete failed: "+del.error.message); return; }
  await loadBets(); await renderAfterData();
}

/* Charts */
function drawBankrollChart(){
  const el=$("bankrollChart"); if(!window.Chart||!el) return;
  const ctx=el.getContext("2d");
  const rows=currentBets().slice().sort((a,b)=>a.date.localeCompare(b.date));
  const startAmt=getActive()?.start_amount||0;
  let eq=startAmt; const labels=[], series=[];
  rows.forEach(b=>{ eq+=b.profit; labels.push(b.date); series.push(Number(eq.toFixed(2))); });

  if(bankrollChart){ try{bankrollChart.destroy();}catch(_){} }
  bankrollChart=new Chart(ctx,{ type:"line",
    data:{ labels, datasets:[{ label:"Bankroll (€)", data:series, borderWidth:2, borderColor:"#22d3ee", backgroundColor:"rgba(34,211,238,0.15)", tension:0.35, fill:true, pointRadius:2, pointHoverRadius:6 }] },
    options:{ ...baseOpts(), plugins:{ legend:{display:false}, tooltip:{enabled:true, displayColors:false, callbacks:{ label:c=>" "+euro(c.parsed.y) } } }, scales:{ x:{ticks:{color:"#93a0b7"}, grid:{color:"rgba(147,160,183,0.1)"}}, y:{ticks:{color:"#93a0b7"}, grid:{color:"rgba(147,160,183,0.1)"}} } }
  });
}

/* Analytics */
function renderAnalytics(){
  const rows=currentBets();
  const settled=rows.filter(b=>b.result!=="pending");
  const avgOdds=settled.length? settled.reduce((s,b)=>s+b.odds,0)/settled.length : 0;
  $("avg-odds").textContent=avgOdds.toFixed(2);
  $("max-dd").textContent=euro(computeMaxDrawdown(rows));
  $("bets-total").textContent=String(rows.length);
  $("bets-pending").textContent=String(rows.filter(b=>b.result==="pending").length);

  const grossWin=settled.filter(b=>b.profit>0).reduce((s,b)=>s+b.profit,0);
  const grossLoss=settled.filter(b=>b.profit<0).reduce((s,b)=>s+b.profit,0);
  const pf=grossLoss? (grossWin/Math.abs(grossLoss)) : 0;
  $("pf").textContent=pf.toFixed(2);

  const avgStake=settled.length? settled.reduce((s,b)=>s+b.stake,0)/settled.length : 0;
  $("avg-stake").textContent=euro(avgStake);

  const medOdds=median(settled.map(b=>b.odds));
  $("median-odds").textContent=medOdds.toFixed(2);

  const seq=settled.slice().sort((a,b)=>a.date.localeCompare(b.date)).map(b=>b.result);
  let lw=0,ll=0,cw=0,cl=0;
  seq.forEach(r=>{ if(r==="win"){ cw++; cl=0; lw=Math.max(lw,cw);} else if(r==="loss"){ cl++; cw=0; ll=Math.max(ll,cl);} else { cw=0; cl=0; } });
  $("streaks").textContent=lw+" / "+ll;

  drawAnalyticsStakeChart(rows); drawPnlBarChart(rows); drawOddsHistogram(rows);
  drawResultsPie(rows); drawPnlMonthChart(rows); drawWinRateBySportChart(rows);
}
function drawAnalyticsStakeChart(rows){
  const c=$("analyticsStakeChart"); if(!window.Chart||!c) return;
  const ctx=c.getContext("2d");
  const bySport={}; rows.forEach(b=>{ bySport[b.sport]=(bySport[b.sport]||0)+b.stake; });
  const labels=Object.keys(bySport), values=Object.values(bySport);
  if(analyticsStakeChart){ try{analyticsStakeChart.destroy();}catch(_){} }
  analyticsStakeChart=new Chart(ctx,{ type:"doughnut",
    data:{ labels, datasets:[{ data:values, borderWidth:1, borderColor:"#0d1524", backgroundColor:["#22d3ee","#7c3aed","#34d399","#f472b6","#fde047","#f97316"] }] },
    options:{ ...baseOpts(), cutout:"70%", plugins:{ legend:{ labels:{ color:"#e7eefc"} } } }
  });
}
function drawPnlBarChart(rows){
  const c=$("pnlBarChart"); if(!window.Chart||!c) return;
  const ctx=c.getContext("2d");
  const daily=groupByDateSum(rows.map(b=>({date:b.date,pnl:b.profit})));
  const labels=daily.map(d=>d.date);
  const values=daily.map(d=>Number(d.pnl.toFixed(2)));
  if(pnlBarChart){ try{pnlBarChart.destroy();}catch(_){} }
  pnlBarChart=new Chart(ctx,{ type:"bar",
    data:{ labels, datasets:[{ label:"P&L (€)", data:values, backgroundColor:"rgba(124,58,237,0.55)" }] },
    options:{ ...baseOpts(), plugins:{ legend:{ display:false } }, scales:{ x:{ticks:{color:"#93a0b7"}, grid:{display:false}}, y:{ticks:{color:"#93a0b7"}, grid:{color:"rgba(147,160,183,0.1)"}} } }
  });
}
function drawOddsHistogram(rows){
  const c=$("oddsHistChart"); if(!window.Chart||!c) return;
  const ctx=c.getContext("2d");
  const bins=[[1,1.5],[1.5,2],[2,2.5],[2.5,3],[3,10]];
  const labels=["1-1.5","1.5-2","2-2.5","2.5-3","3+"];
  const counts=bins.map(r=>{ const lo=r[0], hi=r[1]; return rows.filter(b=>b.odds>=lo && b.odds<(hi||1e9)).length; });
  if(oddsHistChart){ try{oddsHistChart.destroy();}catch(_){} }
  oddsHistChart=new Chart(ctx,{ type:"bar",
    data:{ labels, datasets:[{ label:"Bets", data:counts, backgroundColor:"rgba(34,211,238,0.55)"}] },
    options:{ ...baseOpts(), plugins:{ legend:{ display:false } }, scales:{ x:{ticks:{color:"#93a0b7"}, grid:{display:false}}, y:{ticks:{color:"#93a0b7"}, grid:{color:"rgba(147,160,183,0.1)"}, beginAtZero:true, precision:0 } } }
  });
}
function drawResultsPie(rows){
  const c=$("resultsPieChart"); if(!window.Chart||!c) return;
  const ctx=c.getContext("2d");
  const counts={win:0,loss:0,pending:0,void:0}; rows.forEach(b=>{ counts[b.result]=(counts[b.result]||0)+1; });
  if(resultsPieChart){ try{resultsPieChart.destroy();}catch(_){} }
  resultsPieChart=new Chart(ctx,{ type:"doughnut",
    data:{ labels:["win","loss","pending","void"], datasets:[{ data:[counts.win,counts.loss,counts.pending,counts.void], backgroundColor:["#22c55e","#ef4444","#7c3aed","#64748b"], borderWidth:1, borderColor:"#0d1524" }] },
    options:{ ...baseOpts(), cutout:"65%", plugins:{ legend:{ labels:{ color:"#e7eefc"} } } }
  });
}
function drawPnlMonthChart(rows){
  const c=$("pnlMonthChart"); if(!window.Chart||!c) return;
  const ctx=c.getContext("2d");
  const map=new Map(); rows.forEach(b=>{ const k=b.date.slice(0,7); map.set(k,(map.get(k)||0)+b.profit); });
  const labels=Array.from(map.keys()).sort();
  const values=labels.map(k=>Number((map.get(k)||0).toFixed(2)));
  if(pnlMonthChart){ try{pnlMonthChart.destroy();}catch(_){} }
  pnlMonthChart=new Chart(ctx,{ type:"bar",
    data:{ labels, datasets:[{ label:"Monthly P&L (€)", data:values, backgroundColor:"rgba(34,197,94,0.5)" }] },
    options:{ ...baseOpts(), plugins:{ legend:{ display:false } }, scales:{ x:{ticks:{color:"#93a0b7"}, grid:{display:false}}, y:{ticks:{color:"#93a0b7"}, grid:{color:"rgba(147,160,183,0.1)"}} } }
  });
}
function drawWinRateBySportChart(rows){
  const c=$("winRateBySportChart"); if(!window.Chart||!c) return;
  const ctx=c.getContext("2d");
  const settled=rows.filter(b=>b.result!=="pending");
  const bySport=new Map();
  settled.forEach(b=>{ const rec=bySport.get(b.sport)||{w:0,t:0}; rec.t+=1; if(b.result==="win") rec.w+=1; bySport.set(b.sport,rec); });
  const labels=Array.from(bySport.keys());
  const values=labels.map(s=>{ const r=bySport.get(s); return r.t?(r.w/r.t*100):0; });
  if(winRateBySportChart){ try{winRateBySportChart.destroy();}catch(_){} }
  winRateBySportChart=new Chart(ctx,{ type:"bar",
    data:{ labels, datasets:[{ label:"Win rate %", data:values, backgroundColor:"rgba(99,102,241,0.55)" }] },
    options:{ ...baseOpts(), plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:c=>c.parsed.y.toFixed(1)+"%" } } }, scales:{ x:{ticks:{color:"#93a0b7"}, grid:{display:false}}, y:{ticks:{color:"#93a0b7"}, grid:{color:"rgba(147,160,183,0.1)"}, suggestedMin:0, suggestedMax:100} } }
  });
}

/* Calendar */
function drawCalendar(){
  const rows=currentBets();
  const y=currentMonth.getFullYear(), m=currentMonth.getMonth();
  $("cal-title").textContent=currentMonth.toLocaleString(undefined,{month:"long",year:"numeric"});
  const sums=new Map(), counts=new Map();
  rows.forEach(b=>{ sums.set(b.date,(sums.get(b.date)||0)+b.profit); counts.set(b.date,(counts.get(b.date)||0)+1); });
  const first=new Date(y,m,1), start=new Date(first); start.setDate(first.getDate()-first.getDay());
  const grid=$("calendar-grid"); grid.innerHTML="";
  for(let i=0;i<42;i++){
    const d=new Date(start); d.setDate(start.getDate()+i);
    const iso=d.toISOString().slice(0,10); const pnl=sums.get(iso)||0; const has=counts.has(iso);
    const cell=document.createElement("div"); const outCls=(d.getMonth()!==m)?" out":""; const actCls=(selectedCalendarISO===iso)?" active":"";
    cell.className="cell"+outCls+actCls; cell.title=has?(iso+" - bets: "+(counts.get(iso)||0)+", P/L: "+euro(pnl)):(iso+" - no bets");
    const dateDiv="<div class='date-num'>"+d.getDate()+"</div>";
    let amtDiv=""; if(has){ const pcls=pnl>0?"pos":(pnl<0?"neg":""); amtDiv="<div class='amt "+pcls+"'>"+euroShort(pnl)+"</div>"; }
    cell.innerHTML=dateDiv+amtDiv;
    cell.addEventListener("click",()=>{ selectedCalendarISO=(selectedCalendarISO===iso?null:iso); filterDateISO=selectedCalendarISO; drawCalendar(); updateDayBox(); });
    grid.appendChild(cell);
  }
}
function updateDayBox(){
  const rows=currentBets();
  const label=$("day-selected"), pill=$("day-pnl"), tbody=$("day-tbody");
  tbody.innerHTML="";
  if(!selectedCalendarISO){ label.textContent="—"; pill.textContent="€0"; pill.classList.remove("profit-pos","profit-neg"); return; }
  label.textContent=selectedCalendarISO;
  const dayRows=rows.filter(b=>b.date===selectedCalendarISO);
  const dayPnl=dayRows.reduce((s,b)=>s+b.profit,0);
  pill.textContent=euro(dayPnl); pill.classList.remove("profit-pos","profit-neg"); pill.classList.add(dayPnl>=0?"profit-pos":"profit-neg");
  dayRows.forEach(b=>{
    const tr=document.createElement("tr"); const cls=b.profit>=0?"profit-pos":"profit-neg";
    tr.innerHTML="<td>"+b.sport+"</td><td>"+b.market+"</td><td>"+b.selection+"</td><td class='right'>"+b.odds.toFixed(2)+"</td><td class='right'>€"+b.stake.toFixed(2)+"</td><td class='right'>"+b.result+"</td><td class='right "+cls+"'>€"+b.profit.toFixed(2)+"</td>";
    tbody.appendChild(tr);
  });
}

/* ROI */
function renderROI(){
  const rows=currentBets();
  const settled=rows.filter(b=>b.result!=="pending" && b.result!=="void");
  const staked=settled.reduce((s,b)=>s+b.stake,0);
  const profit=settled.reduce((s,b)=>s+b.profit,0);
  const roi=staked? (profit/staked)*100 : 0;
  $("roi-overall").textContent=roi.toFixed(2)+"%";
  $("roi-settled").textContent=String(settled.length);
  $("roi-profit").textContent=euro(profit);
  $("roi-stake").textContent=euro(staked);

  const bySport={};
  settled.forEach(b=>{ if(!bySport[b.sport]) bySport[b.sport]={bets:0,stake:0,profit:0}; bySport[b.sport].bets++; bySport[b.sport].stake+=b.stake; bySport[b.sport].profit+=b.profit; });
  const tbody=$("roi-tbody"); tbody.innerHTML="";
  Object.keys(bySport).forEach(sport=>{
    const agg=bySport[sport]; const roiPct=agg.stake? (agg.profit/agg.stake)*100 : 0;
    const tr=document.createElement("tr");
    tr.innerHTML="<td>"+sport+"</td><td class='right'>"+agg.bets+"</td><td class='right'>"+euro(agg.stake)+"</td><td class='right "+(roiPct>=0?"profit-pos":"profit-neg")+"'>"+euro(agg.profit)+"</td><td class='right "+(roiPct>=0?"profit-pos":"profit-neg")+"'>"+roiPct.toFixed(2)+"%</td>";
    tbody.appendChild(tr);
  });
}

/* Utils */
function groupByDateSum(items){
  const map=new Map();
  items.forEach(it=>{ map.set(it.date,(map.get(it.date)||0)+Number(it.pnl||0)); });
  return Array.from(map.entries()).sort((a,b)=>a[0].localeCompare(b[0])).map(e=>({date:e[0], pnl:e[1]}));
}
function computeMaxDrawdown(rows){
  const sorted=rows.slice().sort((a,b)=>a.date.localeCompare(b.date));
  const startAmt=getActive()?.start_amount||0;
  let equity=startAmt, peak=startAmt, maxDD=0;
  sorted.forEach(b=>{ equity+=b.profit; if(equity>peak) peak=equity; const dd=peak-equity; if(dd>maxDD) maxDD=dd; });
  return maxDD;
}
