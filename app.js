// app.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://bycktplwlfrdjxghajkg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5Y2t0cGx3bGZyZGp4Z2hhamtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUxNjM0MjEsImV4cCI6MjA3MDczOTQyMX0.ovDq1RLEEuOrTNeSek6-lvclXWmJfOz9DoHOv_L71iw";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

window.addEventListener("DOMContentLoaded", () => {
  // Refs
  const emailInput  = document.getElementById("email");
  const passInput   = document.getElementById("password");
  const signupBtn   = document.getElementById("signup");
  const signinBtn   = document.getElementById("signin");
  const sendLinkBtn = document.getElementById("send-link");
  const signoutBtn  = document.getElementById("signout");
  const dashboard   = document.getElementById("dashboard");
  const bankrollEl  = document.getElementById("bankroll");
  const stakedEl    = document.getElementById("staked");
  const winrateEl   = document.getElementById("winrate");
  const ledgerBody  = document.querySelector("#ledger tbody");

  // Small helper to toggle UI without reloading
  async function render() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      dashboard.style.display = "none";
      signoutBtn.style.display = "none";
      return;
    }
    signoutBtn.style.display = "inline-block";
    dashboard.style.display = "block";
    await supabase.from("profiles").upsert({ id: session.user.id });
    await loadBets();
  }

  // EVENTS (no page reloads)
  signupBtn.addEventListener("click", async () => {
    const email = (emailInput.value || "").trim();
    const password = (passInput.value || "").trim();
    if (!email || !password) return alert("Enter email and password");
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) return alert(error.message);
    alert("Account created. Now click 'Sign in'.");
  });

  signinBtn.addEventListener("click", async () => {
    const email = (emailInput.value || "").trim();
    const password = (passInput.value || "").trim();
    if (!email || !password) return alert("Enter email and password");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return alert(error.message);
    await render();
  });

  sendLinkBtn.addEventListener("click", async () => {
    const email = (emailInput.value || "").trim();
    if (!email) return alert("Enter your email");
    const redirect = window.location.origin + window.location.pathname.replace(/\/?$/, "/");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirect }
    });
    if (error) alert(error.message);
    else alert("Check your email for the magic link.");
  });

  signoutBtn.addEventListener("click", async () => {
    await supabase.auth.signOut();
    await render();
  });

  // Update UI when auth state changes, WITHOUT reloads
  supabase.auth.onAuthStateChange((_event, _session) => {
    render();
  });

  // Initial render
  render();

  // Data
  async function loadBets() {
    const { data, error } = await supabase
      .from("bets_enriched")
      .select("*")
      .order("event_date", { ascending: true });

    if (error) return alert(error.message);

    ledgerBody.innerHTML = "";
    let totalStake = 0, totalProfit = 0, wins = 0, settled = 0;

    (data || []).forEach(r => {
      const stake = Number(r.stake) || 0;
      const odds  = Number(r.odds) || 0;
      const profit = r.result === "win" ? (odds - 1) * stake
                  : r.result === "loss" ? -stake : 0;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${(r.event_date || "").slice(0,10)}</td>
        <td>${r.sport || ""}</td>
        <td>${r.league || ""}</td>
        <td>${r.market || ""}</td>
        <td>${r.selection || ""}</td>
        <td>${odds.toFixed(2)}</td>
        <td>€${stake.toFixed(2)}</td>
        <td>${r.result}</td>
        <td style="color:${profit>=0 ? "#4ade80" : "#f43f5e"}">€${profit.toFixed(2)}</td>
      `;
      ledgerBody.appendChild(tr);

      totalStake  += stake;
      totalProfit += profit;
      if (r.result === "win") wins += 1;
      if (r.result !== "pending") settled += 1;
    });

    stakedEl.textContent   = euro(totalStake);
    bankrollEl.textContent = euro(10000 + totalProfit);
    winrateEl.textContent  = settled ? ((wins/settled)*100).toFixed(1) + "%" : "0%";
  }

  function euro(n) {
    return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n || 0);
  }

  // Add bet
  document.getElementById("add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
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
    await render();
  });

  function emptyNull(id) {
    const v = (document.getElementById(id).value || "").trim();
    return v === "" ? null : v;
  }
});
