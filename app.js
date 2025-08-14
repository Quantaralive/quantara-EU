"use strict";
// QUANTARA — robust build with interactive bankroll chart and crosshair.
// Conservative JS (no optional chaining / arrow funcs) to avoid syntax pitfalls.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/* ======= Supabase ======= */
const SUPABASE_URL = "https://bycktplwlfrdjxghajkg.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5Y2t0cGx3bGZyZGp4Z2hhamtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUxNjM0MjEsImV4cCI6MjA3MDczOTQyMX0.ovDq1RLEEuOrTNeSek6-lvclXWmJfOz9DoHOv_L71iw";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ======= State ======= */
let bankrollStart = Number(localStorage.getItem("quantara_bankroll_start") || "10000");
let allBets = [];
let bankrollChart, analyticsStakeChart, pnlBarChart, oddsHistChart, resultsPieChart;
let activeMonthKey = null;      // "YYYY-MM" or null
let filterDateISO = null;       // exact day from Calendar
let selectedCalendarISO = null; // selected day on Calendar
let currentMonth = new Date();  // month for Calendar

/* ======= Helpers ======= */
function $(id){ return document.getElementById(id); }
function q(sel){ return document.querySelector(sel); }
function euro(n){ return new Intl.NumberFormat("it-IT",{style:"currency",currency:"EUR"}).format(n||0); }
function euroShort(n){ const a=Math.abs(n), s=n<0?"-":""; return a>=1000? s+"€"+(a/1000).toFixed(1)+"k" : s+"€"+a.toFixed(0); }
function emptyNull(id){ const v=($(id).value||"").trim(); return v===""? null : v; }
function monthName(ym){ const p=ym.split("-"); const d=new Date(Number(p[0]), Number(p[1])-1, 1); return d.toLocaleString(undefined,{month:"long", year:"numeric"}); }
function haveChart(){ return !!window.Chart; }

/* ======= Chart helpers & plugins (guarded) ======= */
function registerChartPlugins(){
  if(!haveChart()) return;
  try{ if(window.ChartDataLabels){ Chart.register(window.ChartDataLabels); } }catch(e){}
  const hoverVLinePlugin = {
    id:"hoverVLine",
    afterEvent: function(chart, args){
      const ev = (args && args.event) ? args.event : null;
      chart._inArea = (args && args.inChartArea) ? true : false;
      chart._mouseX = ev ? ev.x : null;
    },
    beforeDraw: function(chart){
      if(!chart._inArea || !chart._mouseX) return;
      const area = chart.chartArea; if(!area) return;
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = "rgba(34,211,238,0.35)";
      ctx.setLineDash([4,4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(chart._mouseX, area.top);
      ctx.lineTo(chart._mouseX, area.bottom);
      ctx.stroke();
      ctx.restore();
    }
  };
  try{ Chart.register(hoverVLinePlugin); }catch(e){}
}
function lineGradient(ctx){
  if(!haveChart()) return "rgba(34,211,238,0.35)";
  const g = ctx.chart.ctx;
  const area = ctx.chart.chartArea;
  if(!area) return "rgba(34,211,238,0.35)";
  const grad = g.createLinearGradient(area.left, area.top, area.right, area.bottom);
  grad.addColorStop(0,"rgba(34,211,238,0.55)");
  grad.addColorStop(1,"rgba(124,58,237,0.20)");
  return grad;
}
function ringGradient(ctx, idx){
  if(!haveChart()) return "#22d3ee";
  const g = ctx.chart.ctx;
  const area = ctx.chart.chartArea;
  if(!area) return "#22d3ee";
  const palettes=[["#22d3ee","#7c3aed"],["#34d399","#0ea5e9"],["#f472b6","#8b5cf6"],["#fde047","#22d3ee"],["#f97316","#22c55e"]];
  const p=palettes[idx%palettes.length];
  const grad=g.createLinearGradient(area.left,area.top,area.right,area.bottom);
  grad.addColorStop(0,p[0]); grad.addColorStop(1,p[1]);
  return grad;
}
const donutShadow = {
  id:"donutShadow",
  beforeDatasetDraw:function(c){ if(!haveChart()||c.config.type!=="doughnut")return; const x=c.ctx; x.save(); x.shadowColor="rgba(0,0,0,0.35)"; x.shadowBlur=14; x.shadowOffsetY=8; },
  afterDatasetDraw:function(c){ if(!haveChart()||c.config.type!=="doughnut")return; c.ctx.restore(); }
};

/* ======= Tabs ======= */
function setTab(tab){
  const panes={ overview:$("tab-overview"), analytics:$("tab-analytics"), roi:$("tab-roi"), calendar:$("tab-calendar") };
  const btns ={ overview:$("tab-btn-overview"), analytics:$("tab-btn-analytics"), roi:$("tab-btn-roi"), calendar:$("tab-btn-calendar") };
  Object.values(panes).forEach(function(p){ p.classList.add("hidden"); });
  Object.values(btns ).forEach(function(b){ b.classList.remove("active"); });
  panes[tab].classList.remove("hidden");
  btns[tab].classList.add("active");
  if(tab==="analytics") renderAnalytics();
  if(tab==="roi") renderROI();
  if(tab==="calendar"){ drawCalendar(); updateDayBox(); }
}

/* ======= Startup ======= */
window.addEventListener("DOMContentLoaded", function(){
  registerChartPlugins();

  $("tab-btn-overview").addEventListener("click",function(){ setTab("overview"); });
  $("tab-btn-analytics").addEventListener("click",function(){ setTab("analytics"); });
  $("tab-btn-roi").addEventListener("click",function(){ setTab("roi"); });
  $("tab-btn-calendar").addEventListener("click",function(){ setTab("calendar"); });

  $("bankroll-start").value=String(bankrollStart);
  $("save-bankroll").addEventListener("click",function(){
    const v=Number($("bankroll-start").value||"0");
    bankrollStart=isNaN(v)?10000:v;
    localStorage.setItem("quantara_bankroll_start",String(bankrollStart));
    renderKPIs(); drawBankrollChart(); if(!$("tab-analytics").classList.contains("hidden")) renderAnalytics();
  });

  $("signup").addEventListener("click",async function(){
    const email=($("email").value||"").trim(), password=($("password").value||"").trim();
    if(!email||!password){ alert("Enter email and password"); return; }
    const out = await supabase.auth.signUp({email:email,password:password});
    if(out.error){ alert(out.error.message); return; }
    alert("Account created. Now click 'Sign in'.");
  });
  $("signin").addEventListener("click",async function(){
    const email=($("email").value||"").trim(), password=($("password").value||"").trim();
    if(!email||!password){ alert("Enter email and password"); return; }
    const out = await supabase.auth.signInWithPassword({email:email,password:password});
    if(out.error){ alert(out.error.message); return; }
    await render();
  });
  $("send-link").addEventListener("click",async function(){
    const email=($("email").value||"").trim();
    if(!email){ alert("Enter your email"); return; }
    const redirect=window.location.origin+window.location.pathname.replace(/\/?$/,"/");
    const out = await supabase.auth.signInWithOtp({email:email,options:{emailRedirectTo:redirect}});
    if(out.error){ alert(out.error.message); } else { alert("Check your email."); }
  });
  $("signout").addEventListener("click",async function(){
    await supabase.auth.signOut();
    q(".container").style.display="none";
    $("signout").style.display="none";
  });

  $("add-form").addEventListener("submit", async function(e){
    e.preventDefault();
    const u = await supabase.auth.getUser();
    const user = (u && u.data) ? u.data.user : null;
    if(!user){ alert("Please sign in first."); return; }
    const payload={
      event_date:$("f-date").value?new Date($("f-date").value).toISOString():new Date().toISOString(),
      sport:$("f-sport").value||"Football",
      league:emptyNull("f-league"),
      market:emptyNull("f-market"),
      selection:emptyNull("f-selection"),
      odds:parseFloat($("f-odds").value||"1.80"),
      stake:parseFloat($("f-stake").value||"100"),
      result:$("f-result").value,
      notes:null
    };
    const ins = await supabase.from("bets").insert(payload);
    if(ins.error){ alert("Insert failed: "+ins.error.message); return; }
    e.target.reset();
    await render();
  });

  $("cal-prev").addEventListener("click",function(){ currentMonth.setMonth(currentMonth.getMonth()-1); drawCalendar(); });
  $("cal-next").addEventListener("click",function(){ currentMonth.setMonth(currentMonth.getMonth()+1); drawCalendar(); });
  $("clear-filter").addEventListener("click",function(){ selectedCalendarISO=null; filterDateISO=null; drawCalendar(); updateDayBox(); });

  render();
});

/* ======= Render root ======= */
async function render(){
  const sess = await supabase.auth.getSession();
  const session = (sess && sess.data) ? sess.data.session : null;
  if(!session){
    q(".container").style.display="none";
    $("signout").style.display="none";
    return;
  }
  $("signout").style.display="inline-block";
  q(".container").style.display="block";

  await supabase.from("profiles").upsert({id:session.user.id});

  const res = await supabase.from("bets_enriched").select("*").order("event_date",{ascending:true});
  if(res.error){ alert(res.error.message); return; }

  allBets=(res.data||[]).map(function(r){
    let pr = 0;
    if(r.result==="win"){ pr=(Number(r.odds)-1)*Number(r.stake); }
    else if(r.result==="loss"){ pr=-Number(r.stake); }
    return {
      id:r.id,
      date:(r.event_date||"").slice(0,10),
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

/* ======= KPIs ======= */
function renderKPIs(){
  const stake=allBets.reduce(function(s,b){ return s+b.stake; },0);
  const profit=allBets.reduce(function(s,b){ return s+b.profit; },0);
  const settled=allBets.filter(function(b){ return b.result!=="pending"; });
  const winRate=settled.length? (settled.filter(function(b){ return b.result==="win"; }).length/settled.length*100) : 0;
  $("bankroll").textContent=euro(bankrollStart+profit);
  $("staked").textContent=euro(stake);
  $("winrate").textContent=winRate.toFixed(1)+"%";
}

/* ======= Ledger tabs (All + months with P/L pills) ======= */
function buildMonthTabs(){
  const wrap=$("month-tabs"); wrap.innerHTML="";
  const groups=new Map(); // YYYY-MM -> pnl
  allBets.forEach(function(b){
    const k=b.date.slice(0,7);
    groups.set(k,(groups.get(k)||0)+b.profit);
  });
  const totalPnL=allBets.reduce(function(s,b){ return s+b.profit; },0);

  const allBtn=document.createElement("button");
  allBtn.className="month-tab"+(activeMonthKey===null?" active":"");
  allBtn.innerHTML="<span>All</span><span class=\"month-pill "+(totalPnL>=0?"pos":"neg")+"\">"+euroShort(totalPnL)+"</span>";
  allBtn.addEventListener("click",function(){ activeMonthKey=null; filterDateISO=null; renderLedger(); buildMonthTabs(); });
  wrap.appendChild(allBtn);

  Array.from(groups.keys()).sort().reverse().forEach(function(ym){
    const pnl=groups.get(ym)||0;
    const btn=document.createElement("button");
    btn.className="month-tab"+(activeMonthKey===ym?" active":"");
    btn.innerHTML="<span>"+monthName(ym)+"</span><span class=\"month-pill "+(pnl>=0?"pos":"neg")+"\">"+euroShort(pnl)+"</span>";
    btn.addEventListener("click",function(){ activeMonthKey=(activeMonthKey===ym?null:ym); filterDateISO=null; renderLedger(); buildMonthTabs(); });
    wrap.appendChild(btn);
  });
}

/* ======= Ledger table ======= */
function renderLedger(){
  const tbody=q("#ledger tbody"); tbody.innerHTML="";
  let rows=allBets.slice();
  if(activeMonthKey){ rows=rows.filter(function(b){ return b.date.indexOf(activeMonthKey)===0; }); }
  else if(filterDateISO){ rows=rows.filter(function(b){ return b.date===filterDateISO; }); }

  rows.forEach(function(b){
    const tr=document.createElement("tr");
    const cls=b.profit>=0?"profit-pos":"profit-neg";
    tr.innerHTML =
      "<td>"+b.date+"</td><td>"+b.sport+"</td><td>"+b.league+"</td><td>"+b.market+"</td>"+
      "<td>"+b.selection+"</td><td class='right'>"+b.odds.toFixed(2)+"</td>"+
      "<td class='right'>€"+b.stake.toFixed(2)+"</td><td class='right'>"+b.result+"</td>"+
      "<td class='right "+cls+"'>€"+b.profit.toFixed(2)+"</td>";
    tbody.appendChild(tr);
  });
}

/* ======= Bankroll chart (interactive + crosshair) ======= */
function drawBankrollChart(){
  if(!haveChart()) return;
  const ctx=$("bankrollChart").getContext("2d");
  const sorted=allBets.slice().sort(function(a,b){ return a.date.localeCompare(b.date); });
  let eq=bankrollStart; const labels=[]; const series=[];
  sorted.forEach(function(b){ eq+=b.profit; labels.push(b.date); series.push(Number(eq.toFixed(2))); });

  if(bankrollChart){ try{ bankrollChart.destroy(); }catch(e){} }
  bankrollChart=new Chart(ctx,{
    type:"line",
    data:{ labels:labels, datasets:[{
      label:"Bankroll (€)",
      data:series,
      borderWidth:2,
      tension:0.35,
      fill:true,
      backgroundColor:function(c){ return lineGradient(c); },
      pointRadius:3,
      pointHoverRadius:7,
      pointHitRadius:20
    }]},
    options:{
      animation:{ duration:300 },
      responsive:true,
      maintainAspectRatio:false,
      interaction:{ mode:"nearest", intersect:false },
      onHover:function(evt, elements, chart){ chart.canvas.style.cursor = (elements && elements.length) ? "pointer" : "default"; },
      plugins:{
        legend:{ display:false },
        tooltip:{
          enabled:true,
          displayColors:false,
          callbacks:{
            title:function(items){ return items[0] ? items[0].label : ""; },
            label:function(ctx){ return " "+euro(ctx.parsed.y); }
          }
        },
        datalabels:{
          align:"top", offset:6, color:"#e7eefc", font:{ weight:600, size:11 },
          formatter:function(v){ return euro(v); },
          display:function(context){
            const i=context.dataIndex;
            const last=context.dataset.data.length-1;
            return i===last || context.active;
          }
        }
      },
      scales:{
        x:{ ticks:{ color:"#93a0b7" }, grid:{ color:"rgba(147,160,183,0.1)" } },
        y:{ ticks:{ color:"#93a0b7" }, grid:{ color:"rgba(147,160,183,0.1)" } }
      }
    }
  });
}

/* ======= Analytics ======= */
function renderAnalytics(){
  const settled=allBets.filter(function(b){ return b.result!=="pending"; });
  const avgOdds = settled.length ? settled.reduce(function(s,b){return s+b.odds;},0)/settled.length : 0;
  $("avg-odds").textContent=avgOdds.toFixed(2);
  $("max-dd").textContent=euro(computeMaxDrawdown());
  $("bets-total").textContent=String(allBets.length);
  $("bets-pending").textContent=String(allBets.filter(function(b){ return b.result==="pending"; }).length);

  drawAnalyticsStakeChart();
  drawPnlBarChart();
  drawOddsHistogram();
  drawResultsPie();
}
function drawAnalyticsStakeChart(){
  if(!haveChart()) return;
  const wrap=q(".donut-wrap-lg"), canvas=$("analyticsStakeChart"), ctx=canvas.getContext("2d");
  canvas.width=wrap.clientWidth; canvas.height=wrap.clientHeight;
  const bySport={}; allBets.forEach(function(b){ bySport[b.sport]=(bySport[b.sport]||0)+b.stake; });
  const labels=Object.keys(bySport), values=Object.values(bySport);
  if(analyticsStakeChart){ try{ analyticsStakeChart.destroy(); }catch(e){} }
  analyticsStakeChart=new Chart(ctx,{
    type:"doughnut",
    data:{ labels:labels, datasets:[{ data:values, borderWidth:1, borderColor:"#0d1524", backgroundColor:function(c){ return ringGradient(c,c.dataIndex); }, hoverOffset:6 }] },
    options:{ responsive:false, maintainAspectRatio:false, plugins:{ legend:{ labels:{ color:"#e7eefc"} } }, cutout:"76%", radius:"70%" },
    plugins:[donutShadow]
  });
}
function drawPnlBarChart(){
  if(!haveChart()) return;
  const ctx=$("pnlBarChart").getContext("2d");
  const daily=groupByDateSum(allBets.map(function(b){ return {date:b.date, pnl:b.profit}; }));
  const labels=daily.map(function(d){return d.date;});
  const values=daily.map(function(d){return Number(d.pnl.toFixed(2));});
  if(pnlBarChart){ try{ pnlBarChart.destroy(); }catch(e){} }
  pnlBarChart=new Chart(ctx,{ type:"bar", data:{labels:labels, datasets:[{label:"P&L (€)", data:values}]}, options:{ responsive:true, plugins:{legend:{display:false}}, scales:{ x:{ticks:{color:"#93a0b7"}, grid:{display:false}}, y:{ticks:{color:"#93a0b7"}, grid:{color:"rgba(147,160,183,0.1)"}} } });
}
function drawOddsHistogram(){
  if(!haveChart()) return;
  const ctx=$("oddsHistChart").getContext("2d");
  const bins=[[1,1.5],[1.5,2],[2,2.5],[2.5,3],[3,10]];
  const labels=["1–1.5","1.5–2","2–2.5","2.5–3","3+"];
  const counts=bins.map(function(r){ const lo=r[0], hi=r[1]; return allBets.filter(function(b){ return b.odds>=lo && b.odds<(hi||1e9); }).length; });
  if(oddsHistChart){ try{ oddsHistChart.destroy(); }catch(e){} }
  oddsHistChart=new Chart(ctx,{ type:"bar", data:{labels:labels, datasets:[{label:"Bets", data:counts}]}, options:{ responsive:true, plugins:{legend:{display:false}}, scales:{ x:{ticks:{color:"#93a0b7"}, grid:{display:false}}, y:{ticks:{color:"#93a0b7"}, grid:{color:"rgba(147,160,183,0.1)"}, beginAtZero:true, precision:0} } });
}
function drawResultsPie(){
  if(!haveChart()) return;
  const ctx=$("resultsPieChart").getContext("2d");
  const counts={win:0,loss:0,pending:0,void:0}; allBets.forEach(function(b){ counts[b.result]=(counts[b.result]||0)+1; });
  if(resultsPieChart){ try{ resultsPieChart.destroy(); }catch(e){} }
  resultsPieChart=new Chart(ctx,{ type:"doughnut", data:{ labels:["win","loss","pending","void"], datasets:[{ data:[counts.win,counts.loss,counts.pending,counts.void], backgroundColor:function(c){ return ringGradient(c,c.dataIndex); }, borderWidth:1, borderColor:"#0d1524" }]}, options:{ plugins:{legend:{labels:{color:"#e7eefc"}}}, cutout:"65%" }, plugins:[donutShadow] });
}

/* ======= Calendar ======= */
function drawCalendar(){
  const y=currentMonth.getFullYear(), m=currentMonth.getMonth();
  $("cal-title").textContent=currentMonth.toLocaleString(undefined,{month:"long", year:"numeric"});

  const sums=new Map(), counts=new Map();
  allBets.forEach(function(b){ sums.set(b.date,(sums.get(b.date)||0)+b.profit); counts.set(b.date,(counts.get(b.date)||0)+1); });

  const first=new Date(y,m,1);
  const start=new Date(first); start.setDate(first.getDate()-first.getDay());
  const grid=$("calendar-grid"); grid.innerHTML="";

  for(let i=0;i<42;i++){
    const d=new Date(start); d.setDate(start.getDate()+i); const iso=d.toISOString().slice(0,10);
    const pnl=sums.get(iso)||0; const has=counts.has(iso);

    const cell=document.createElement("div");
    cell.className="cell"+(d.getMonth()!==m?" out":"")+(selectedCalendarISO===iso?" active":"");
    cell.title = has ? (iso+" — bets: "+counts.get(iso)+", P/L: "+euro(pnl)) : (iso+" — no bets");
    cell.innerHTML = "<div class='date-num'>"+d.getDate()+"</div>"+(has?("<div class='amt "+(pnl>0?"pos":(pnl<0?"neg":""))+"'>"+euroShort(pnl)+"</div>"):"");
    (function(isoCopy){
      cell.addEventListener("click",function(){ selectedCalendarISO = (selectedCalendarISO===isoCopy? null : isoCopy); filterDateISO=selectedCalendarISO; drawCalendar(); updateDayBox(); });
    })(iso);
    grid.appendChild(cell);
  }
}
function updateDayBox(){
  const label=$("day-selected"), pill=$("day-pnl"), tbody=$("day-tbody"); tbody.innerHTML="";
  if(!selectedCalendarISO){ label.textContent="—"; pill.textContent="€0"; pill.classList.remove("profit-pos"); pill.classList.remove("profit-neg"); return; }
  label.textContent=selectedCalendarISO;
  const rows=allBets.filter(function(b){ return b.date===selectedCalendarISO; });
  const dayPnl=rows.reduce(function(s,b){ return s+b.profit; },0);
  pill.textContent=euro(dayPnl);
  pill.classList.remove("profit-pos"); pill.classList.remove("profit-neg");
  pill.classList.add(dayPnl>=0?"profit-pos":"profit-neg");
  rows.forEach(function(b){
    const tr=document.createElement("tr");
    const cls=b.profit>=0?"profit-pos":"profit-neg";
    tr.innerHTML="<td>"+b.sport+"</td><td>"+b.market+"</td><td>"+b.selection+"</td><td class='right'>"+b.odds.toFixed(2)+"</td><td class='right'>€"+b.stake.toFixed(2)+"</td><td class='right'>"+b.result+"</td><td class='right "+cls+"'>€"+b.profit.toFixed(2)+"</td>";
    tbody.appendChild(tr);
  });
}

/* ======= ROI ======= */
function renderROI(){
  const settled=allBets.filter(function(b){ return b.result!=="pending" && b.result!=="void"; });
  const staked=settled.reduce(function(s,b){ return s+b.stake; },0);
  const profit=settled.reduce(function(s,b){ return s+b.profit; },0);
  const roi=staked? (profit/staked)*100 : 0;

  $("roi-overall").textContent = roi.toFixed(2) + "%";
  $("roi-settled").textContent = String(settled.length);
  $("roi-profit").textContent  = euro(profit);
  $("roi-stake").textContent   = euro(staked);

  const bySport={};
  settled.forEach(function(b){
    if(!bySport[b.sport]) bySport[b.sport]={bets:0, stake:0, profit:0};
    bySport[b.sport].bets++; bySport[b.sport].stake+=b.stake; bySport[b.sport].profit+=b.profit;
  });

  const tbody=$("roi-tbody"); tbody.innerHTML="";
  Object.keys(bySport).forEach(function(sport){
    const agg=bySport[sport];
    const roiPct=agg.stake? (agg.profit/agg.stake)*100 : 0;
    const tr=document.createElement("tr");
    tr.innerHTML="<td>"+sport+"</td><td class='right'>"+agg.bets+"</td><td class='right'>"+euro(agg.stake)+"</td><td class='right "+(agg.profit>=0?"profit-pos":"profit-neg")+"'>"+euro(agg.profit)+"</td><td class='right "+(roiPct>=0?"profit-pos":"profit-neg")+"'>"+roiPct.toFixed(2)+"%</td>";
    tbody.appendChild(tr);
  });
}

/* ======= Utils ======= */
function groupByDateSum(items){
  const map=new Map();
  items.forEach(function(it){ map.set(it.date,(map.get(it.date)||0)+it.pnl); });
  return Array.from(map.entries()).sort(function(a,b){ return a[0].localeCompare(b[0]); }).map(function(e){ return {date:e[0], pnl:e[1]}; });
}
function computeMaxDrawdown(){
  const sorted=allBets.slice().sort(function(a,b){ return a.date.localeCompare(b.date); });
  let equity=bankrollStart, peak=bankrollStart, maxDD=0;
  sorted.forEach(function(b){
    equity+=b.profit;
    if(equity>peak) peak=equity;
    const dd=peak-equity;
    if(dd>maxDD) maxDD=dd;
  });
  return maxDD;
}
