"use strict";

/* Supabase */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://bycktplwlfrdjxghajkg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5Y2t0cGx3bGZyZGp4Z2hhamtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUxNjM0MjEsImV4cCI6MjA3MDczOTQyMX0.ovDq1RLEEuOrTNeSek6-lvclXWmJfOz9DoHOv_L71iw";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* State */
let bankrollStart = Number(localStorage.getItem("quantara_bankroll_start") || "10000");
let allBets = [];
let bankrollChart = null;
let analyticsStakeChart = null;
let pnlBarChart = null;
let oddsHistChart = null;
let resultsPieChart = null;
let pnlMonthChart = null;
let winRateBySportChart = null;

let activeMonthKey = null;      // "YYYY-MM" or null
let filterDateISO = null;       // exact day (Calendar)
let selectedCalendarISO = null; // chosen day in Calendar
let currentMonth = new Date();  // Calendar month
let editingId = null;           // id of bet being edited

/* Helpers */
function $(id){ return document.getElementById(id); }
function q(sel){ return document.querySelector(sel); }

function euro(n){
  const v = Number(n || 0);
  return new Intl.NumberFormat("it-IT",{style:"currency",currency:"EUR"}).format(v);
}
function euroShort(n){
  const v = Number(n || 0);
  const s = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if(a >= 1000) return s + "€" + (a/1000).toFixed(1) + "k";
  return s + "€" + a.toFixed(0);
}
function emptyNull(id){
  const el = $(id);
  const v = el ? String(el.value || "").trim() : "";
  return v === "" ? null : v;
}
function monthName(ym){
  const parts = ym.split("-");
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
  return d.toLocaleString(undefined, { month:"long", year:"numeric" });
}
function median(arr){
  const a = arr.slice().sort((x,y)=>x-y);
  if(!a.length) return 0;
  const m = Math.floor(a.length/2);
  return a.length%2 ? a[m] : (a[m-1]+a[m])/2;
}

/* Tabs */
function setTab(tab){
  const panes = { overview:$("tab-overview"), analytics:$("tab-analytics"), roi:$("tab-roi"), calendar:$("tab-calendar") };
  const btns  = { overview:$("tab-btn-overview"), analytics:$("tab-btn-analytics"), roi:$("tab-btn-roi"), calendar:$("tab-btn-calendar") };
  Object.values(panes).forEach(p=>p.classList.add("hidden"));
  Object.values(btns).forEach(b=>b.classList.remove("active"));
  panes[tab].classList.remove("hidden");
  btns[tab].classList.add("active");
  if(tab==="analytics") renderAnalytics();
  if(tab==="roi") renderROI();
  if(tab==="calendar"){ drawCalendar(); updateDayBox(); }
}

/* Startup */
window.addEventListener("DOMContentLoaded", function(){
  $("tab-btn-overview").addEventListener("click", ()=>setTab("overview"));
  $("tab-btn-analytics").addEventListener("click", ()=>setTab("analytics"));
  $("tab-btn-roi").addEventListener("click", ()=>setTab("roi"));
  $("tab-btn-calendar").addEventListener("click", ()=>setTab("calendar"));

  $("bankroll-start").value = String(bankrollStart);
  $("save-bankroll").addEventListener("click", ()=>{
    const v = Number($("bankroll-start").value || "0");
    bankrollStart = isNaN(v) ? 10000 : v;
    localStorage.setItem("quantara_bankroll_start", String(bankrollStart));
    renderKPIs(); drawBankrollChart(); if(!$("tab-analytics").classList.contains("hidden")) renderAnalytics();
  });

  $("signup").addEventListener("click", async ()=>{
    const email = String($("email").value || "").trim();
    const password = String($("password").value || "").trim();
    if(!email || !password){ alert("Enter email and password"); return; }
    const out = await supabase.auth.signUp({ email, password });
    if(out.error){ alert(out.error.message); return; }
    alert("Account created. Now click Sign in.");
  });
  $("signin").addEventListener("click", async ()=>{
    const email = String($("email").value || "").trim();
    const password = String($("password").value || "").trim();
    if(!email || !password){ alert("Enter email and password"); return; }
    const out = await supabase.auth.signInWithPassword({ email, password });
    if(out.error){ alert(out.error.message); return; }
    await render();
  });
  $("send-link").addEventListener("click", async ()=>{
    const email = String($("email").value || "").trim();
    if(!email){ alert("Enter your email"); return; }
    const redirect = window.location.origin + window.location.pathname.replace(/\/?$/,"/");
    const out = await supabase.auth.signInWithOtp({ email, options:{ emailRedirectTo:redirect } });
    if(out.error){ alert(out.error.message); } else { alert("Check your email."); }
  });
  $("signout").addEventListener("click", async ()=>{
    await supabase.auth.signOut();
    q(".container").style.display="none";
    $("signout").style.display="none";
  });

  // Add bet
  $("add-form").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const u = await supabase.auth.getUser();
    const user = u && u.data ? u.data.user : null;
    if(!user){ alert("Please sign in first."); return; }
    const payload = {
      event_date: $("f-date").value ? new Date($("f-date").value).toISOString() : new Date().toISOString(),
      sport: $("f-sport").value || "Football",
      league: emptyNull("f-league"),
      market: emptyNull("f-market"),
      selection: emptyNull("f-selection"),
      odds: parseFloat($("f-odds").value || "1.80"),
      stake: parseFloat($("f-stake").value || "100"),
      result: $("f-result").value,
      notes: null
    };
    const ins = await supabase.from("bets").insert(payload);
    if(ins.error){ alert("Insert failed: " + ins.error.message); return; }
    e.target.reset();
    await render();
  });

  // Ledger actions via delegation
  q("#ledger tbody").addEventListener("click", function(ev){
    const btn = ev.target.closest(".action-btn");
    if(!btn) return;
    const id = btn.getAttribute("data-id");
    const action = btn.getAttribute("data-action");
    if(action==="edit") openEdit(id);
    if(action==="delete") deleteBet(id);
  });

  // Edit modal controls
  $("edit-close").addEventListener("click", closeEdit);
  $("edit-cancel").addEventListener("click", closeEdit);
  $("edit-form").addEventListener("submit", onEditSubmit);

  // Calendar controls
  $("cal-prev").addEventListener("click", ()=>{ currentMonth.setMonth(currentMonth.getMonth()-1); drawCalendar(); });
  $("cal-next").addEventListener("click", ()=>{ currentMonth.setMonth(currentMonth.getMonth()+1); drawCalendar(); });
  $("clear-filter").addEventListener("click", ()=>{ selectedCalendarISO=null; filterDateISO=null; drawCalendar(); updateDayBox(); });

  render();
});

/* Main render */
async function render(){
  const sess = await supabase.auth.getSession();
  const session = sess && sess.data ? sess.data.session : null;
  if(!session){
    q(".container").style.display="none";
    $("signout").style.display="none";
    return;
  }
  $("signout").style.display="inline-block";
  q(".container").style.display="block";

  await supabase.from("profiles").upsert({ id: session.user.id });

  const res = await supabase.from("bets_enriched").select("*").order("event_date",{ascending:true});
  if(res.error){ alert(res.error.message); return; }

  allBets = (res.data || []).map(r=>{
    let pr = 0;
    if(r.result==="win"){ pr=(Number(r.odds)-1)*Number(r.stake); }
    else if(r.result==="loss"){ pr=-Number(r.stake); }
    return {
      id:r.id,
      date:String(r.event_date||"").slice(0,10),
      sport:r.sport||"",
      league:r.league||"",
      market:r.market||"",
      selection:r.selection||"",
      odds:Number(r.odds)||0,
      stake:Number(r.stake)||0,
      result:r.result,
      profit:pr
    };
  });

  renderKPIs();
  drawBankrollChart();
  buildMonthTabs();
  renderLedger();

  if(!$("tab-analytics").classList.contains("hidden")) renderAnalytics();
  if(!$("tab-roi").classList.contains("hidden")) renderROI();
  if(!$("tab-calendar").classList.contains("hidden")){ drawCalendar(); updateDayBox(); }
}

/* KPIs */
function renderKPIs(){
  const stake = allBets.reduce((s,b)=>s+b.stake,0);
  const profit = allBets.reduce((s,b)=>s+b.profit,0);
  const settled = allBets.filter(b=>b.result!=="pending");
  const wins = settled.filter(b=>b.result==="win").length;
  const winRate = settled.length ? (wins/settled.length)*100 : 0;
  $("bankroll").textContent=euro(bankrollStart+profit);
  $("staked").textContent=euro(stake);
  $("winrate").textContent=winRate.toFixed(1)+"%";
}

/* Ledger month tabs */
function buildMonthTabs(){
  const wrap=$("month-tabs"); wrap.innerHTML="";
  const groups=new Map(); // yyyy-mm -> pnl
  allBets.forEach(b=>{ const k=b.date.slice(0,7); groups.set(k,(groups.get(k)||0)+b.profit); });
  const totalPnL=allBets.reduce((s,b)=>s+b.profit,0);

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

/* Ledger table with actions */
function renderLedger(){
  const tbody=q("#ledger tbody"); tbody.innerHTML="";
  let rows=allBets.slice();
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
        "<button class='action-btn action-edit' data-action='edit' data-id='"+b.id+"'>Edit</button>"+
        "<button class='action-btn action-del' data-action='delete' data-id='"+b.id+"'>Delete</button>"+
      "</td>";
    tbody.appendChild(tr);
  });
}

/* Edit / Delete */
function openEdit(id){
  const b = allBets.find(x=>String(x.id)===String(id));
  if(!b){ alert("Bet not found"); return; }
  editingId = b.id;
  $("e-id").value = String(b.id);
  $("e-date").value = b.date;
  $("e-sport").value = b.sport;
  $("e-league").value = b.league;
  $("e-market").value = b.market;
  $("e-selection").value = b.selection;
  $("e-odds").value = String(b.odds);
  $("e-stake").value = String(b.stake);
  $("e-result").value = b.result;
  $("edit-modal").classList.remove("hidden");
}
function closeEdit(){ $("edit-modal").classList.add("hidden"); editingId=null; }
async function onEditSubmit(e){
  e.preventDefault();
  if(!editingId){ closeEdit(); return; }
  const payload = {
    event_date: $("e-date").value ? new Date($("e-date").value).toISOString() : new Date().toISOString(),
    sport: $("e-sport").value || "Football",
    league: emptyNull("e-league"),
    market: emptyNull("e-market"),
    selection: emptyNull("e-selection"),
    odds: parseFloat($("e-odds").value || "1.80"),
    stake: parseFloat($("e-stake").value || "100"),
    result: $("e-result").value
  };
  const upd = await supabase.from("bets").update(payload).eq("id", editingId);
  if(upd.error){ alert("Update failed: " + upd.error.message); return; }
  closeEdit();
  await render();
}
async function deleteBet(id){
  if(!confirm("Delete this bet?")) return;
  const del = await supabase.from("bets").delete().eq("id", id);
  if(del.error){ alert("Delete failed: " + del.error.message); return; }
  await render();
}

/* Charts */
function drawBankrollChart(){
  const el = $("bankrollChart"); if(!window.Chart || !el) return;
  const ctx=el.getContext("2d");
  const sorted=allBets.slice().sort((a,b)=>a.date.localeCompare(b.date));
  let eq=bankrollStart; const labels=[]; const series=[];
  sorted.forEach(b=>{ eq+=b.profit; labels.push(b.date); series.push(Number(eq.toFixed(2))); });

  if(bankrollChart){ try{ bankrollChart.destroy(); }catch(_){} }
  bankrollChart=new Chart(ctx,{
    type:"line",
    data:{ labels, datasets:[{
      label:"Bankroll (€)", data:series, borderWidth:2, borderColor:"#22d3ee",
      backgroundColor:"rgba(34,211,238,0.15)", tension:0.35, fill:true, pointRadius:2, pointHoverRadius:6
    }]},
    options:{
      responsive:true, maintainAspectRatio:false, resizeDelay:200,
      plugins:{ legend:{display:false}, tooltip:{enabled:true, displayColors:false, callbacks:{ label:c=>" "+euro(c.parsed.y) } } },
      scales:{ x:{ticks:{color:"#93a0b7"}, grid:{color:"rgba(147,160,183,0.1)"}}, y:{ticks:{color:"#93a0b7"}, grid:{color:"rgba(147,160,183,0.1)"}} }
    }
  });
}

/* Analytics */
function renderAnalytics(){
  const settled = allBets.filter(b=>b.result!=="pending");
  const avgOdds = settled.length ? settled.reduce((s,b)=>s+b.odds,0)/settled.length : 0;
  $("avg-odds").textContent=avgOdds.toFixed(2);
  $("max-dd").textContent=euro(computeMaxDrawdown());
  $("bets-total").textContent=String(allBets.length);
  $("bets-pending").textContent=String(allBets.filter(b=>b.result==="pending").length);

  // New KPIs
  const grossWin = settled.filter(b=>b.profit>0).reduce((s,b)=>s+b.profit,0);
  const grossLoss = settled.filter(b=>b.profit<0).reduce((s,b)=>s+b.profit,0); // negative
  const pf = grossLoss ? (grossWin/Math.abs(grossLoss)) : 0;
  $("pf").textContent = pf.toFixed(2);

  const avgStake = settled.length ? settled.reduce((s,b)=>s+b.stake,0)/settled.length : 0;
  $("avg-stake").textContent = euro(avgStake);

  const medOdds = median(settled.map(b=>b.odds));
  $("median-odds").textContent = medOdds.toFixed(2);

  // streaks
  const seq = settled.slice().sort((a,b)=>a.date.localeCompare(b.date)).map(b=>b.result);
  let lw=0,ll=0, cw=0, cl=0;
  seq.forEach(r=>{
    if(r==="win"){ cw+=1; cl=0; lw=Math.max(lw,cw); }
    else if(r==="loss"){ cl+=1; cw=0; ll=Math.max(ll,cl); }
    else{ cw=0; cl=0; }
  });
  $("streaks").textContent = lw + " / " + ll;

  drawAnalyticsStakeChart();
  drawPnlBarChart();
  drawOddsHistogram();
  drawResultsPie();
  drawPnlMonthChart();
  drawWinRateBySportChart();
}
function drawAnalyticsStakeChart(){
  const canvas=$("analyticsStakeChart"); if(!window.Chart || !canvas) return;
  const ctx=canvas.getContext("2d");
  const bySport={}; allBets.forEach(b=>{ bySport[b.sport]=(bySport[b.sport]||0)+b.stake; });
  const labels=Object.keys(bySport), values=Object.values(bySport);
  if(analyticsStakeChart){ try{ analyticsStakeChart.destroy(); }catch(_){} }
  analyticsStakeChart=new Chart(ctx,{ type:"doughnut", data:{ labels, datasets:[{ data:values, borderWidth:1, borderColor:"#0d1524", backgroundColor:["#22d3ee","#7c3aed","#34d399","#f472b6","#fde047","#f97316"] }] }, options:{ responsive:true, maintainAspectRatio:false, resizeDelay:200, cutout:"70%", plugins:{ legend:{ labels:{ color:"#e7eefc"} } } } });
}
function drawPnlBarChart(){
  const canvas=$("pnlBarChart"); if(!window.Chart || !canvas) return;
  const ctx=canvas.getContext("2d");
  const daily=groupByDateSum(allBets.map(b=>({date:b.date, pnl:b.profit})));
  const labels=daily.map(d=>d.date);
  const values=daily.map(d=>Number(d.pnl.toFixed(2)));
  if(pnlBarChart){ try{ pnlBarChart.destroy(); }catch(_){} }
  pnlBarChart=new Chart(ctx,{ type:"bar", data:{labels, datasets:[{label:"P&L (€)", data:values, backgroundColor:"rgba(124,58,237,0.55)"}]}, options:{ responsive:true, maintainAspectRatio:false, resizeDelay:200, plugins:{legend:{display:false}}, scales:{ x:{ticks:{color:"#93a0b7"}, grid:{display:false}}, y:{ticks:{color:"#93a0b7"}, grid:{color:"rgba(147,160,183,0.1)"}} } });
}
function drawOddsHistogram(){
  const canvas=$("oddsHistChart"); if(!window.Chart || !canvas) return;
  const ctx=canvas.getContext("2d");
  const bins=[[1,1.5],[1.5,2],[2,2.5],[2.5,3],[3,10]];
  const labels=["1-1.5","1.5-2","2-2.5","2.5-3","3+"];
  const counts=bins.map(r=>{ const lo=r[0], hi=r[1]; return allBets.filter(b=>b.odds>=lo && b.odds<(hi||1e9)).length; });
  if(oddsHistChart){ try{ oddsHistChart.destroy(); }catch(_){} }
  oddsHistChart=new Chart(ctx,{ type:"bar", data:{labels, datasets:[{label:"Bets", data:counts, backgroundColor:"rgba(34,211,238,0.55)"}]}, options:{ responsive:true, maintainAspectRatio:false, resizeDelay:200, plugins:{legend:{display:false}}, scales:{ x:{ticks:{color:"#93a0b7"}, grid:{display:false}}, y:{ticks:{color:"#93a0b7"}, grid:{color:"rgba(147,160,183,0.1)"}, beginAtZero:true, precision:0} } });
}
function drawResultsPie(){
  const canvas=$("resultsPieChart"); if(!window.Chart || !canvas) return;
  const ctx=canvas.getContext("2d");
  const counts={win:0,loss:0,pending:0,void:0}; allBets.forEach(b=>{ counts[b.result]=(counts[b.result]||0)+1; });
  if(resultsPieChart){ try{ resultsPieChart.destroy(); }catch(_){} }
  resultsPieChart=new Chart(ctx,{ type:"doughnut", data:{ labels:["win","loss","pending","void"], datasets:[{ data:[counts.win,counts.loss,counts.pending,counts.void], backgroundColor:["#22c55e","#ef4444","#7c3aed","#64748b"], borderWidth:1, borderColor:"#0d1524" }]}, options:{ responsive:true, maintainAspectRatio:false, resizeDelay:200, cutout:"65%", plugins:{legend:{labels:{color:"#e7eefc"}}} } });
}
function drawPnlMonthChart(){
  const canvas=$("pnlMonthChart"); if(!window.Chart || !canvas) return;
  const ctx=canvas.getContext("2d");
  const map=new Map();
  allBets.forEach(b=>{ const k=b.date.slice(0,7); map.set(k,(map.get(k)||0)+b.profit); });
  const labels=Array.from(map.keys()).sort();
  const values=labels.map(k=>Number((map.get(k)||0).toFixed(2)));
  if(pnlMonthChart){ try{ pnlMonthChart.destroy(); }catch(_){} }
  pnlMonthChart=new Chart(ctx,{ type:"bar", data:{ labels, datasets:[{ label:"Monthly P&L (€)", data:values, backgroundColor:"rgba(34,197,94,0.5)" }] }, options:{ responsive:true, maintainAspectRatio:false, resizeDelay:200, plugins:{legend:{display:false}}, scales:{ x:{ticks:{color:"#93a0b7"}, grid:{display:false}}, y:{ticks:{color:"#93a0b7"}, grid:{color:"rgba(147,160,183,0.1)"}} } });
}
function drawWinRateBySportChart(){
  const canvas=$("winRateBySportChart"); if(!window.Chart || !canvas) return;
  const ctx=canvas.getContext("2d");
  const settled=allBets.filter(b=>b.result!=="pending");
  const bySport=new Map();
  settled.forEach(b=>{
    const rec=bySport.get(b.sport)||{w:0,t:0};
    rec.t+=1; if(b.result==="win") rec.w+=1;
    bySport.set(b.sport,rec);
  });
  const labels=Array.from(bySport.keys());
  const values=labels.map(s=>{ const r=bySport.get(s); return r.t? (r.w/r.t*100) : 0; });
  if(winRateBySportChart){ try{ winRateBySportChart.destroy(); }catch(_){} }
  winRateBySportChart=new Chart(ctx,{ type:"bar", data:{ labels, datasets:[{ label:"Win rate %", data:values, backgroundColor:"rgba(99,102,241,0.55)" }] }, options:{ responsive:true, maintainAspectRatio:false, resizeDelay:200, plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>c.parsed.y.toFixed(1)+"%"}}}, scales:{ x:{ticks:{color:"#93a0b7"}, grid:{display:false}}, y:{ticks:{color:"#93a0b7"}, grid:{color:"rgba(147,160,183,0.1)"}, suggestedMin:0, suggestedMax:100} } });
}

/* Calendar */
function drawCalendar(){
  const y=currentMonth.getFullYear(), m=currentMonth.getMonth();
  $("cal-title").textContent=currentMonth.toLocaleString(undefined,{month:"long",year:"numeric"});
  const sums=new Map(), counts=new Map();
  allBets.forEach(b=>{ sums.set(b.date,(sums.get(b.date)||0)+b.profit); counts.set(b.date,(counts.get(b.date)||0)+1); });

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
  const label=$("day-selected"), pill=$("day-pnl"), tbody=$("day-tbody");
  tbody.innerHTML="";
  if(!selectedCalendarISO){ label.textContent="—"; pill.textContent="€0"; pill.classList.remove("profit-pos","profit-neg"); return; }
  label.textContent=selectedCalendarISO;
  const rows=allBets.filter(b=>b.date===selectedCalendarISO);
  const dayPnl=rows.reduce((s,b)=>s+b.profit,0);
  pill.textContent=euro(dayPnl); pill.classList.remove("profit-pos","profit-neg"); pill.classList.add(dayPnl>=0?"profit-pos":"profit-neg");
  rows.forEach(b=>{
    const tr=document.createElement("tr"); const cls=b.profit>=0?"profit-pos":"profit-neg";
    tr.innerHTML="<td>"+b.sport+"</td><td>"+b.market+"</td><td>"+b.selection+"</td><td class='right'>"+b.odds.toFixed(2)+"</td><td class='right'>€"+b.stake.toFixed(2)+"</td><td class='right'>"+b.result+"</td><td class='right "+cls+"'>€"+b.profit.toFixed(2)+"</td>";
    tbody.appendChild(tr);
  });
}

/* ROI */
function renderROI(){
  const settled=allBets.filter(b=>b.result!=="pending" && b.result!=="void");
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
    tr.innerHTML="<td>"+sport+"</td><td class='right'>"+agg.bets+"</td><td class='right'>"+euro(agg.stake)+"</td><td class='right "+(agg.profit>=0?"profit-pos":"profit-neg")+"'>"+euro(agg.profit)+"</td><td class='right "+(roiPct>=0?"profit-pos":"profit-neg")+"'>"+roiPct.toFixed(2)+"%</td>";
    tbody.appendChild(tr);
  });
}

/* Utils */
function groupByDateSum(items){
  const map=new Map();
  items.forEach(it=>{ map.set(it.date,(map.get(it.date)||0)+Number(it.pnl||0)); });
  return Array.from(map.entries()).sort((a,b)=>a[0].localeCompare(b[0])).map(e=>({date:e[0], pnl:e[1]}));
}
function computeMaxDrawdown(){
  const sorted=allBets.slice().sort((a,b)=>a.date.localeCompare(b.date));
  let equity=bankrollStart, peak=bankrollStart, maxDD=0;
  sorted.forEach(b=>{ equity+=b.profit; if(equity>peak) peak=equity; const dd=peak-equity; if(dd>maxDD) maxDD=dd; });
  return maxDD;
}
