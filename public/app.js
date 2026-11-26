import { PEOPLE, planFor as basePlanFor, normChange, weekDays } from "./plans.js";
import { chartData, mmss } from "./charts.js";
// Every plan lookup goes through the accepted changes (TJH/WGW, /api/plan).
const planFor = (p, w) => basePlanFor(p, w, state.planChanges);
import { t as tr, tKind, localized, applyStatic, setLang, setTheme, currentLang, currentTheme } from "./i18n.js";

const HISTORY_WEEKS = 5;
const POLL_MS = 45_000;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CHECK = '<svg viewBox="0 0 16 16" fill="none" stroke="#0f1115" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3L13 4.5"/></svg>';

// ── small helpers ────────────────────────────────────────────────────────────
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return addDays(x, -((x.getDay() + 6) % 7)); };
const fromIso = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
const person = (id) => PEOPLE.find((p) => p.id === id);
const qsKey = (p, w, i) => `person=${p}&week=${w}&item=${encodeURIComponent(i)}`;

// Time helpers: accept "32:10", "1:02:30", or digits-only "3210" / "10230"
function normTime(v, { pace = false } = {}) {
  v = String(v || "").trim().replace(/[.,'′″\s]+/g, ":");
  if (!v) return "";
  if (/^\d+$/.test(v)) {
    if (v.length <= 2) return pace ? "" : `${+v}:00`; // bare minutes
    const s = v.slice(-2), rest = v.slice(0, -2);
    v = rest.length > 2 && !pace ? `${+rest.slice(0, -2)}:${rest.slice(-2)}:${s}` : `${+rest}:${s}`;
  }
  const parts = v.split(":").map(Number);
  if (parts.some(isNaN) || parts.length < 2 || parts.length > (pace ? 2 : 3) || parts.slice(1).some((x) => x > 59)) return null;
  return parts.map((x, i) => (i === 0 ? String(x) : String(x).padStart(2, "0"))).join(":");
}
const toSec = (t) => t.split(":").map(Number).reduce((a, x) => a * 60 + x, 0);
const fmtPace = (secPerKm) => `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, "0")}`;

// ── state ────────────────────────────────────────────────────────────────────
const state = {
  tab: PEOPLE.some((p) => p.id === store.get("tab")) || store.get("tab") === "board" ? store.get("tab") : PEOPLE[0].id,
  week: iso(mondayOf(new Date())),
  done: new Map(), // "TJH|2026-11-16" -> Set(itemId)
  logs: new Map(), // "TJH|2026-11-16|tue" -> row
  loaded: new Set(),
  passcode: store.get("passcode") || "",
  online: true,
  lastSync: null,
  wgw: null, // public Garmin summary for WGW (wgw.json): suggestion, calendar, weekly minutes
  hist: new Map(), // "SJH" -> { activities, logs, at } (self-logged history, 26 weeks)
  today: new Map(), // "SJH" -> { suggestion, reason, loading, error, at, dirty }
  goals: {}, // "SJH" -> { text, date, zh } one-line target at the top of the tab (/api/goal)
  planChanges: {}, // "TJH|2026-11-16" -> { from, sessions, why, source_date } accepted plan changes (/api/plan)
};
const thisWeek = () => iso(mondayOf(new Date()));
const doneSet = (p, w) => {
  const k = `${p}|${w}`;
  if (!state.done.has(k)) state.done.set(k, new Set());
  return state.done.get(k);
};
const logOf = (p, w, i) => state.logs.get(`${p}|${w}|${i}`);

// ── API ──────────────────────────────────────────────────────────────────────
let unlockWaiters = [];
async function request(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "x-passcode": state.passcode, ...(opts.body && !(opts.body instanceof Blob) ? { "content-type": "application/json" } : {}), ...(opts.headers || {}) },
  });
  if (res.status === 401) {
    showLock();
    await new Promise((r) => unlockWaiters.push(r));
    return request(path, opts);
  }
  return res;
}
async function api(path, opts) {
  const res = await request(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function load(from, to) {
  try {
    const { rows } = await api(`/api/progress?from=${from}&to=${to}`);
    for (let w = fromIso(from); iso(w) <= to; w = addDays(w, 7)) {
      for (const p of PEOPLE) {
        doneSet(p.id, iso(w)).clear();
        for (const k of [...state.logs.keys()]) if (k.startsWith(`${p.id}|${iso(w)}|`)) state.logs.delete(k);
      }
      state.loaded.add(iso(w));
    }
    for (const r of rows) {
      doneSet(r.person, r.week).add(r.item);
      state.logs.set(`${r.person}|${r.week}|${r.item}`, r);
    }
    state.online = true;
    state.lastSync = new Date();
  } catch {
    state.online = false;
  }
  render();
}
const historyRange = () => [iso(addDays(fromIso(state.week), -7 * (HISTORY_WEEKS - 1))), state.week];
const refresh = () => (loadGoals(), loadPlanChanges(), load(...historyRange()));

// ── Plan changes (TJH/WGW): Claude proposes in the daily suggestion, the runner accepts or dismisses ──
async function loadPlanChanges() {
  try {
    const from = iso(addDays(mondayOf(new Date()), -7 * 26)), to = iso(addDays(mondayOf(new Date()), 7));
    const d = await api(`/api/plan?from=${from}&to=${to}`);
    state.planChanges = d.changes || {};
    state.proposals = d.proposals || {}; // waiting plan rebuilds (lib/rebuild.js)
  } catch { return; }
  if (!sheet.item && !act.open && !goalSheet.p) render();
}
const DAY_LONG = { Mon: "Mon", Tue: "Tue", Wed: "Wed", Thu: "Thu", Fri: "Fri", Sat: "Sat", Sun: "Sun" };
const proposalOf = (p) => (p === "WGW" ? state.wgw?.suggestion : state.today.get(p)?.suggestion);
const dismissKey = (p, s) => `planDismiss:${p}:${s.date}`;
/** The proposal box inside the Today card ("" when there's none, it was dismissed, or its week is over). */
const dayDate = (d) => `${tr(DAY_LONG[DAYS[(fromIso(d).getDay() + 6) % 7]])} ${+d.slice(5, 7)}.${+d.slice(8)}`;
function proposalBox(p, s) {
  const pc = normChange(s?.plan_change);
  if (!pc || s.date !== iso(new Date()) || pc.end < iso(new Date())) return "";
  const cur = state.planChanges[`${p}|${iso(mondayOf(fromIso(pc.start < iso(new Date()) ? iso(new Date()) : pc.start)))}`];
  if (cur?.source_date === s.date) return `<p class="smute sprop-ok">${tr("Plan change accepted ✓")}</p>`;
  if (store.get(dismissKey(p, s))) return "";
  const range = pc.start === pc.end ? dayDate(pc.start) : `${dayDate(pc.start)} → ${dayDate(pc.end)}`;
  return `<div class="sprop"><b>${tr("Proposed plan change · {w}", { w: range })}</b>
    <p>${esc((currentLang() === "zh" && s.zh?.plan_why) || pc.why)}</p>
    <ul>${pc.sessions.map((x) => `<li><span>${dayDate(x.date)}</span> ${esc(tKind(x.kind))} · ${esc(x.title)}${x.meta ? ` <small>(${esc(x.meta)})</small>` : ""}</li>`).join("") || `<li>${tr("Rest")}</li>`}</ul>
    <div class="smute">${tr("Other days in this range are rest; days outside it don't change.")}</div>
    <div class="sprop-btns"><button class="ghost" data-dismiss="${p}">${tr("Dismiss")}</button><button data-accept="${p}">${tr("Accept")}</button></div></div>`;
}
/** An empty future week (SJH): today's suggestion may carry Claude's draft for it. */
function draftWeek(p, color) {
  todayOf(p); // loads today's suggestion if needed
  const s = state.today.get(p)?.suggestion, pc = normChange(s?.plan_change);
  const box = pc && pc.start <= iso(addDays(fromIso(state.week), 6)) && pc.end >= state.week ? proposalBox(p, s) : "";
  return `<div class="sugg" style="--c:${color}"><div class="shead"><span>${tr("Proposed week")}</span></div>
    ${box || `<p class="smute">${tr("When a week has no plan yet, Claude drafts one in the 9:00 suggestion. It shows here to accept.")}</p>`}</div>`;
}
/** A rebuilt plan waiting for the runner (Claude drafted it within computed limits; /api/rebuild). */
function rebuildBox(p, color) {
  const pr = state.proposals?.[p];
  if (!pr) return "";
  const weeks = [];
  for (let w = pr.start; w <= pr.end; w = iso(addDays(fromIso(w), 7))) weeks.push(w);
  const pz = pr.paces;
  return `<div class="sugg rebuild" style="--c:${color}"><div class="shead"><span>${tr("Your plan, rebuilt")}</span><b class="call">${tr("5K goal {t}", { t: pr.goal5k })}</b></div>
    <p>${esc(pr.why)}</p>
    <p class="sform"><b>${tr("Paces")}</b> E ${esc(pz.E)} · T ${esc(pz.T)} · I ${esc(pz.I)} · R ${esc(pz.R)} · G ${esc(pz.G)} /km</p>
    ${weeks.map((w, i) => `<details class="snum"${i === 0 ? " open" : ""}><summary>${tr("Week of {d}", { d: md(fromIso(w)) })}${pr.focus?.[w] ? ` · ${esc(pr.focus[w])}` : ""}</summary>
      <ul>${pr.sessions.filter((x) => x.date >= w && x.date <= iso(addDays(fromIso(w), 6))).map((x) =>
        `<li><b>${dayDate(x.date)}</b> ${esc(tKind(x.kind))} · ${esc(x.title)}${x.meta ? ` <small>(${esc(x.meta)})</small>` : ""}</li>`).join("")}</ul></details>`).join("")}
    <div class="smute">${tr("Replaces these weeks of the plan; days without a session are rest. Paces are computed from your own runs.")}</div>
    <div class="sprop-btns"><button class="ghost" data-rbdismiss="${p}">${tr("Dismiss")}</button><button data-rbaccept="${p}">${tr("Accept")}</button></div></div>`;
}
async function rebuildAction(p, accept) {
  const pr = state.proposals?.[p]; if (!pr) return;
  if (!accept && !confirm(tr("Dismiss the rebuilt plan?"))) return;
  try {
    if (accept) {
      const r = await api("/api/plan", { method: "POST", body: JSON.stringify({ person: p, today: iso(new Date()), change: pr, source: iso(new Date()) }) });
      Object.assign(state.planChanges, r.changes || {});
      toast(tr("Plan updated ✓"));
    } else await api(`/api/rebuild?person=${p}`, { method: "DELETE" });
    delete state.proposals[p];
  } catch (e) { toast(e.message); }
  render();
}
async function acceptProposal(p) {
  const s = proposalOf(p), pc = normChange(s?.plan_change); if (!pc) return;
  try {
    const r = await api("/api/plan", { method: "POST", body: JSON.stringify({ person: p, today: iso(new Date()), change: pc, source: s.date }) });
    Object.assign(state.planChanges, r.changes || {});
    toast(tr("Plan updated ✓"));
  } catch (e) { toast(e.message); }
  render();
}
async function revertPlan(p, week) {
  if (!confirm(tr("Go back to the original plan for this week?"))) return;
  try {
    await api("/api/plan", { method: "POST", body: JSON.stringify({ person: p, week, revert: true }) });
    delete state.planChanges[`${p}|${week}`];
  } catch (e) { toast(e.message); }
  render();
}

// ── Target line (top of each runner's tab): English text, Chinese copy made on save ──
// Same rule as lib/rules.js TEXT_RULES.goal (the server enforces it; this is for a friendly message first).
const GOAL_RE = /^[A-Za-z0-9 .,:;'’()+\-–—/&!?#]*$/, GOAL_MAX = 60;
async function loadGoals() {
  try { state.goals = (await api("/api/goal")).goals || {}; } catch { return; }
  if (!sheet.item && !act.open && !goalSheet.p) render();
}
function goalLine(pid) {
  const g = state.goals[pid]?.text ? state.goals[pid] : null;
  if (!g) return `<button class="goal add" data-goal="${pid}">${tr("+ Set a target")}</button>`;
  const text = currentLang() === "zh" && g.zh ? g.zh : g.text;
  let when = "";
  if (g.date) {
    const [, m, d] = g.date.split("-").map(Number);
    const days = Math.round((fromIso(g.date) - fromIso(iso(new Date()))) / 864e5);
    when = `<span>${m}.${d}</span><span>${esc(days > 0 ? tr("{n} days to go", { n: days }) : days === 0 ? tr("Today!") : tr("done"))}</span>`;
  }
  return `<button class="goal" data-goal="${pid}"><b>🎯 ${esc(text)}</b>${when}</button>`;
}
function openGoal(pid) {
  const g = state.goals[pid];
  goalSheet.p = pid;
  $("#goalKind").textContent = pid;
  $("#gText").value = g?.text || "";
  $("#gDate").value = g?.date || "";
  $("#gClear").hidden = !g?.text;
  $("#gHr").hidden = pid === "WGW"; // WGW's health data stays off the site
  $("#gMax").value = g?.max_hr ?? "";
  $("#gRest").value = g?.rest_hr ?? "";
  $("#gNote").value = g?.note || "";
  $("#goalSheet").classList.add("show");
  document.body.classList.add("noscroll");
}
function closeGoal() {
  goalSheet.p = null;
  $("#goalSheet").classList.remove("show");
  document.body.classList.remove("noscroll");
}
const goalSheet = { p: null };
async function saveGoal(clear) {
  const p = goalSheet.p; if (!p) return;
  const text = clear ? "" : $("#gText").value.replace(/\s+/g, " ").trim();
  if (text.length > GOAL_MAX || !GOAL_RE.test(text)) return toast(tr("Target: English letters, digits and basic punctuation, up to 60 characters"));
  const btn = $("#gSave"); btn.disabled = true;
  try {
    const hr = p === "WGW" ? {} : { max_hr: $("#gMax").value.trim() || null, rest_hr: $("#gRest").value.trim() || null };
    const r = await api("/api/goal", { method: "POST", body: JSON.stringify({ person: p, text, date: clear ? null : $("#gDate").value || null, ...hr }) });
    state.goals[p] = r.goal;
    const note = $("#gNote").value.replace(/\s+/g, " ").trim();
    if (note !== (r.goal.note || "")) state.goals[p] = (await api("/api/goal", { method: "POST", body: JSON.stringify({ person: p, note }) })).goal;
    if (p !== "WGW") dataChanged(p); // today's suggestion is now older than the target → ↻ Refresh shows
    closeGoal(); render(); toast(tr("Saved ✓"));
  } catch (e) { toast(e.message); }
  btn.disabled = false;
}

async function setDone(p, w, item, done) {
  const set = doneSet(p, w);
  const prevLog = logOf(p, w, item);
  done ? set.add(item) : (set.delete(item), state.logs.delete(`${p}|${w}|${item}`));
  if (done && navigator.vibrate) navigator.vibrate(12);
  render();
  try {
    const r = await api("/api/progress", { method: "POST", body: JSON.stringify({ person: p, week: w, item, done }) });
    if (r.row) state.logs.set(`${p}|${w}|${item}`, r.row);
    state.online = true;
    dataChanged(p);
    return true;
  } catch {
    done ? set.delete(item) : (set.add(item), prevLog && state.logs.set(`${p}|${w}|${item}`, prevLog));
    state.online = false;
    toast(tr("Couldn't save — check your connection"));
    render();
    return false;
  }
}

// ── status helpers ───────────────────────────────────────────────────────────
const todayIndex = () => (new Date().getDay() + 6) % 7;
function itemStatus(week, it, isDone) {
  if (isDone) return "done";
  const cur = thisWeek();
  if (week < cur) return "miss";
  if (week > cur) return "todo";
  if (it.dayIndex < todayIndex()) return "miss";
  if (it.dayIndex === todayIndex()) return "next";
  return "todo";
}
function summary(p, w) {
  const plan = planFor(p, w);
  if (plan.empty) return null;
  const items = plan.items.filter((i) => !i.rest);
  const set = doneSet(p, w);
  const done = items.filter((i) => set.has(i.id)).length;
  const km = items.reduce((a, i) => a + (set.has(i.id) ? Number(logOf(p, w, i.id)?.km) || 0 : 0), 0);
  return { plan, items, done, total: items.length, pct: items.length ? done / items.length : 0, km };
}
const loggedLine = (l) => !l ? "" : [
  l.km && `${l.km} km`, l.duration, l.pace && `${l.pace}/km`, l.hr && `♥ ${l.hr}`, l.has_photo ? "📷" : "", l.note ? "💬" : "",
].filter(Boolean).join(" · ");

// ── rendering ────────────────────────────────────────────────────────────────
function renderHeader() {
  const mon = fromIso(state.week);
  const sun = addDays(mon, 6);
  const cur = thisWeek();
  const rel = tr(state.week === cur ? "This week" : state.week === iso(addDays(fromIso(cur), -7)) ? "Last week"
    : state.week === iso(addDays(fromIso(cur), 7)) ? "Next week" : "Tap for this week");
  $("#weekLabel").innerHTML = `${md(mon)} – ${md(sun)}<small>${rel}</small>`;

  const tabs = [...PEOPLE.map((p) => ({ id: p.id, label: p.id, color: p.color })), { id: "board", label: tr("📊 All"), color: "var(--text)" }];
  $("#tabs").innerHTML = tabs.map((t) => `
    <button class="tab" role="tab" data-tab="${t.id}" aria-selected="${state.tab === t.id}" style="--c:${t.color}">
      ${t.id !== "board" ? `<span class="dot" style="background:${t.color}"></span>` : ""}${esc(t.label)}
    </button>`).join("");
}

function renderPerson(pid) {
  const p = person(pid);
  const s = summary(pid, state.week);
  if (!s) {
    const plan = planFor(pid, state.week);
    let html = `<div class="hero" style="--c:${p.color}"><h1>${esc(pid)}</h1><div class="sub">${esc(p.blurb)}</div>${goalLine(pid)}</div>
      <div class="empty">${esc(tr(plan.empty))}</div>`;
    if (pid === "SJH" && state.week > thisWeek()) html += draftWeek(pid, p.color);
    if (pid !== "WGW") html += (state.week === thisWeek() ? renderToday(pid, p.color) : "") + renderSelfLog(pid, p.color);
    return html;
  }
  const { plan, done, total, pct, km } = s;
  const set = doneSet(pid, state.week);
  const mon = fromIso(state.week);
  const isCur = state.week === thisWeek();

  let html = `<div class="hero" style="--c:${p.color}">
      ${goalLine(pid)}<h1>${esc(plan.title)}</h1><div class="sub">${esc(pid)} · ${esc(plan.sub)}</div>
      ${plan.adjusted != null ? `<div class="adjusted">✎ <b>${tr("Adjusted")}</b> ${esc(plan.adjusted)} <button data-revert="${pid}">${tr("Revert")}</button></div>` : ""}
      <div class="progress"><div class="track"><div class="fill" style="width:${pct * 100}%;background:${pct === 1 ? "var(--ok)" : p.color}"></div></div>
      <b>${done}/${total}</b></div>
      ${km ? `<div class="sub">${tr("{n} km logged", { n: Math.round(km * 10) / 10 })}</div>` : ""}
    </div>`;

  // A session done on another day (its My log activity is linked to it) shows on the day it was done.
  const doneOn = new Map();
  for (const a of state.hist.get(pid)?.activities || []) {
    if (a.week !== state.week || !set.has(a.item)) continue;
    const di = Math.round((fromIso(a.date) - mon) / 864e5);
    if (di >= 0 && di <= 6) doneOn.set(a.item, di);
  }
  const byDay = new Map();
  for (const it of plan.items) {
    const di = doneOn.get(it.id) ?? it.dayIndex;
    if (!byDay.has(di)) byDay.set(di, []);
    byDay.get(di).push(it);
  }
  for (const [di, items] of [...byDay].sort((a, b) => a[0] - b[0])) {
    const date = addDays(mon, di);
    const today = isCur && di === todayIndex();
    html += `<div class="dayrow${today ? " today" : ""}" style="--c:${p.color}">
      <div class="date"><b>${date.getDate()}</b><span>${today ? tr("Today") : tr(DAYS[di])}</span></div><div class="stack">`;
    for (const it of items) {
      if (it.rest) { html += `<div class="rest">${esc(it.title)}</div>`; continue; }
      const d = set.has(it.id);
      const missed = itemStatus(state.week, it, d) === "miss"; // day has passed, not ticked
      const logged = d ? loggedLine(logOf(pid, state.week, it.id)) : "";
      html += `<button class="run${d ? " done" : ""}${missed ? " missed" : ""}" data-item="${it.id}" aria-pressed="${d}"${missed ? ' aria-label="Missed: ' + esc(it.title) + '"' : ""}>
          <span class="cbar" style="background:${it.color}"></span>
          <span class="body"><div class="kind" style="color:${it.color}">${esc(tKind(it.kind))}${missed ? `<span class="mtag">${tr("Missed")}</span>` : ""}</div>
            <div class="title">${esc(it.title)}</div>${it.meta ? `<div class="meta">${esc(it.meta)}</div>` : ""}
            ${doneOn.has(it.id) && doneOn.get(it.id) !== it.dayIndex ? `<div class="moved">${tr("Planned {d}, done here", { d: tr(DAYS[it.dayIndex]) })}</div>` : ""}
            ${d ? `<div class="logged">${logged ? esc(logged) : tr("+ add details")}</div>` : ""}</span>
          <span class="box">${CHECK}</span></button>`;
    }
    html += `</div></div>`;
  }

  if (plan.notes) {
    const n = plan.notes;
    html += `<details class="notes"${store.get("notesOpen") === "1" ? " open" : ""}><summary>${esc(tr(n.title))}</summary>
      ${n.rows.map(([tg, c, nm, v, sm]) => `<div class="pace"><span class="tg" style="background:${c}">${tg}</span>
        <span class="nm">${esc(tKind(nm))}</span><span class="v">${esc(v)}<small>${esc(sm)}</small></span></div>`).join("")}
      ${n.text.map((t) => `<p>${esc(t)}</p>`).join("")}</details>`;
  }
  if (pid === "WGW" && isCur) html += renderSuggestion(p.color);
  if (pid !== "WGW" && isCur) html += renderToday(pid, p.color);

  html += pid === "WGW" ? renderWgwDash() : renderSelfLog(pid, p.color);
  return html;
}

// ── WGW: daily suggestion + public Garmin summary (wgw.json, rebuilt each morning) ──
const WGW_COLORS = { push: "#e8a23a", pull: "#4aa3df", legs: "#b072e0", reinforce: "#7d8593", unlogged: "#3a404b", gym: "#4aa3df",
  run: "#3fb97a", swim: "#4cc0e6", bike: "#9bc25a", hike: "#c49a68", other: "#7d8593" };
const CALL_LABEL = { rest: "Rest", easy: "Easy", planned: "As planned", quality: "Quality", gym: "Gym", cross: "Cross-train" };
const CALL_COLOR = { rest: "#e5604d", easy: "#3fb97a", planned: "#4aa3df", quality: "#e8a23a", gym: "#b072e0", cross: "#4cc0e6" };
let wgwLoadedAt = 0;

async function loadWgw() {
  if (Date.now() - wgwLoadedAt < 10 * 60_000) return; // the file changes once a day
  try {
    const r = await fetch(`/wgw.json?d=${iso(new Date())}`, { cache: "no-store" });
    if (!r.ok) return;
    state.wgw = await r.json();
    wgwLoadedAt = Date.now();
    if ((state.tab === "WGW" || state.tab === "board") && !sheet.item) render();
  } catch {}
}

/** WGW's next gym session: { title, items: ["Deadlift 4×8, ≤100 kg, 2 in reserve", ...], note }. */
function gymBlock(g) {
  if (!g?.items?.length) return "";
  return `<div class="sgym"><b>${tr("Gym")}${g.title ? ` · ${esc(g.title)}` : ""}</b>
    <ul>${g.items.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>${g.note ? `<div class="smute">${esc(g.note)}</div>` : ""}</div>`;
}

function renderSuggestion(color) {
  const s = localized(state.wgw?.suggestion);
  const today = iso(new Date());
  if (!s || s.date !== today) {
    return `<div class="sugg" style="--c:${color}"><div class="shead"><span>${tr("Today")}</span></div>
      <p class="smute">${tr(state.wgw ? "No suggestion yet today. It's written at 9:00 after the Garmin sync." : "Loading today's suggestion…")}</p></div>`;
  }
  const c = CALL_COLOR[s.call] || color;
  return `<div class="sugg" style="--c:${c}">
    <div class="shead"><span>${tr("Today")}</span><b class="call">${esc(tr(CALL_LABEL[s.call] || s.call))}</b></div>
    ${s.yesterday ? `<p class="syest"><b>${tr("Yesterday")}</b> ${esc(s.yesterday)}</p>` : ""}
    ${s.reply ? `<p class="swin"><b>${tr("Re: your note")}</b> ${esc(s.reply)}</p>` : ""}
    ${s.win ? `<p class="swin"><b>${tr("Well done")}</b> ${esc(s.win)}</p>` : ""}
    <div class="stitle">${esc(s.headline)}</div>
    ${s.session ? `<div class="ssess">${esc(s.session)}</div>` : ""}
    ${s.why ? `<p>${esc(s.why)}</p>` : ""}
    ${gymBlock(s.gym)}
    ${s.science ? `<p class="ssci"><b>${tr("Why it works")}</b> ${esc(s.science)}</p>` : ""}
    ${s.club ? `<p class="sclub"><b>${tr("Club")}</b> ${esc(s.club)}</p>` : ""}
    ${s.next ? `<p class="smute">${tr("Tomorrow:")} ${esc(s.next)}</p>` : ""}
    ${proposalBox("WGW", state.wgw.suggestion)}
  </div>`;
}

function renderWgwDash() {
  const g = state.wgw;
  if (!g) return "";
  return renderDash(g, { splits: true, note: tr("From Garmin, updated {t}.", { t: g.generated }) });
}

/** Calendar (26 weeks) + minutes per week. g = { dataThrough, calendar: {date: {gym, cardio[]}}, weekly: [{week, gym, run, ...}] } */
function renderDash(g, { splits = false, note = "" } = {}) {
  const end = fromIso(g.dataThrough);
  const start = addDays(mondayOf(end), -7 * 25); // 26 weeks
  let cal = "", lastMonth = -1;
  for (let w = new Date(start); w <= end; w = addDays(w, 7)) {
    cal += `<div class="cm">${w.getMonth() !== lastMonth ? tr(["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][w.getMonth()]) : ""}</div>`;
    lastMonth = w.getMonth();
    for (let i = 0; i < 7; i++) {
      const d = addDays(w, i), k = iso(d), e = g.calendar[k];
      if (d > end) { cal += `<div class="cd" style="visibility:hidden"></div>`; continue; }
      const parts = e ? [e.gym ? (e.gym === "gym" ? tr("gym") : `${tr("gym")} ${tr(e.gym)}`) : null, ...e.cardio.map((c) => tr(c))].filter(Boolean) : [];
      const bg = e?.gym ? `background:${WGW_COLORS[e.gym]}` : "";
      const dot = e?.cardio.length ? `<i class="${e.gym ? "" : "solo"}" style="background:${WGW_COLORS[e.cardio[0]]}"></i>` : "";
      cal += `<div class="cd" style="${bg}" title="${k}${parts.length ? ": " + esc(parts.join(", ")) : ""}">${dot}</div>`;
    }
  }
  const weeks = g.weekly.slice(-12), types = ["gym", "run", "swim", "bike", "hike", "other"];
  const max = Math.max(60, ...weeks.map((w) => types.reduce((a, t) => a + (w[t] || 0), 0)));
  const bars = weeks.map((w) => {
    const tot = types.reduce((a, t) => a + (w[t] || 0), 0);
    const segs = types.filter((t) => w[t]).map((t) =>
      `<span style="height:${(w[t] / max) * 100}%;background:${t === "gym" ? WGW_COLORS.pull : WGW_COLORS[t]}" title="${tr(t)} ${w[t]} min"></span>`).join("");
    return `<div class="wb" title="${tr("Week of {d}: {n} min", { d: md(fromIso(w.week)), n: tot })}"><div class="wstack">${segs}</div><small>${md(fromIso(w.week))}</small></div>`;
  }).join("");
  const key = (list, dot) => list.map((t) => `<span><i class="${dot ? "dot" : ""}" style="background:${WGW_COLORS[t]}"></i>${tr(t)}</span>`).join("");
  const cardio = ["run", "swim", "bike", "hike"].concat(splits ? [] : ["other"]);
  return `<div class="section">${tr("Training calendar")}</div>
    <div class="wcard"><div class="calscroll" id="dashCal"><div class="wcal">${cal}</div></div>
      <div class="wkey">${key(splits ? ["push", "pull", "legs", "reinforce"] : ["gym"], false)}${key(cardio, true)}</div></div>
    <div class="section">${tr("Minutes per week")}</div>
    <div class="wcard"><div class="wbars">${bars}</div>
      <div class="wkey"><span><i style="background:${WGW_COLORS.pull}"></i>gym</span>${key(cardio, false)}</div>
      ${note ? `<div class="legend">${esc(note)}</div>` : ""}</div>`;
}

// ── TJH / SJH: self-logged history, calendar + minutes, daily suggestion ─────
const durMin = (t) => (t ? Math.round(toSec(t) / 60) : 0);
const actLine = (a) => {
  const x = parseExtra(a);
  return [a.km && `${a.km} km`, a.duration, a.pace && `${a.pace}/km`, a.hr && `♥ ${a.hr}`, a.cadence && `${a.cadence} spm`,
    x.vert_osc_cm && `↕ ${x.vert_osc_cm} cm`, x.gct_ms && `${x.gct_ms} ms`,
    a.photo_idx && `📷 ${String(a.photo_idx).split(",").length}`, a.item && `✓ ${tr("plan")}`].filter(Boolean).join(" · ");
};
const actDate = (d) => {
  const x = fromIso(d);
  return `${tr(DAYS[(x.getDay() + 6) % 7])} ${md(x)}${x.getFullYear() !== new Date().getFullYear() ? `/${String(x.getFullYear()).slice(2)}` : ""}`;
};

async function loadHist(p) {
  const h = state.hist.get(p);
  if (h && (h.loading || Date.now() - h.at < 5 * 60_000)) return;
  const prev = h || { activities: [], logs: [] };
  state.hist.set(p, { ...prev, loading: true, at: prev.at || 0 });
  try {
    const from = iso(addDays(mondayOf(new Date()), -7 * 25)), to = iso(new Date());
    const d = await api(`/api/activities?person=${p}&from=${from}&to=${to}`);
    state.hist.set(p, { activities: d.activities, logs: d.logs, at: Date.now(), ready: true });
  } catch (e) {
    state.hist.set(p, { ...prev, at: Date.now(), ready: true, error: e.message });
  }
  if ((state.tab === p || state.tab === "board") && !sheet.item && !act.open) render();
}

async function loadToday(p) {
  const today = iso(new Date());
  const cur = state.today.get(p) || {};
  state.today.set(p, { ...cur, loading: true, dirty: false });
  try {
    const d = await api("/api/today", { method: "POST", body: JSON.stringify({ person: p, today }) });
    state.today.set(p, { suggestion: d.suggestion, newer: d.newer, refresh: d.refresh, date: today, at: Date.now() });
    if (d.refresh?.pending) pollToday(p);
  } catch (e) {
    state.today.set(p, { ...cur, loading: false, error: e.message, date: today, at: Date.now() });
  }
  if ((state.tab === p || state.tab === "board") && !sheet.item && !act.open) render();
}

/** While a refresh is being written on the Mac, re-read the card every 20 s (one timer per runner). */
const polls = new Map();
function pollToday(p) {
  if (polls.has(p)) return;
  polls.set(p, setTimeout(() => { polls.delete(p); loadToday(p); }, 20_000));
}

async function requestRefresh(p) {
  const t = state.today.get(p) || {};
  try {
    const r = await api("/api/refresh", { method: "POST", body: JSON.stringify({ person: p, today: iso(new Date()) }) });
    state.today.set(p, { ...t, refresh: r, refreshError: null });
    if (r.pending) pollToday(p);
  } catch (e) {
    state.today.set(p, { ...t, refreshError: e.message });
  }
  render();
}

/** ↻ Refresh after new sessions (max 5/day): queued on the site, written by Claude on the Mac. */
function refreshLine(p, t) {
  const r = t?.refresh;
  if (!r) return "";
  if (r.pending) return `<p class="smute srefresh">${tr("Rewriting… usually 1–3 min.")}</p>`;
  const err = t.refreshError ? `<p class="smute">${esc(t.refreshError)}</p>`
    : r.failed ? `<p class="smute">${tr("The last refresh didn't go through (it wasn't counted). Try again later.")}</p>` : "";
  if (!t.newer && t.suggestion) return err;
  if (!r.left) return err + `<p class="smute">${tr("All {n} refreshes for today are used.", { n: r.used })}</p>`;
  return err + `<button class="srefresh-btn" data-refresh="${p}">${tr("↻ Refresh suggestion")}<small>${tr("{n} left today", { n: r.left })}</small></button>`;
}

/** New sessions: refetch history and let the server decide whether today's suggestion needs rewriting. */
function dataChanged(p) {
  const t = state.today.get(p); if (t) t.dirty = true;
  const h = state.hist.get(p); if (h) h.at = 0;
}

function suggestionCard(s, color, mute) {
  if (!s) return `<div class="sugg" style="--c:${color}"><div class="shead"><span>${tr("Today")}</span></div><p class="smute">${esc(mute)}</p></div>`;
  s = localized(s);
  const by = s.by === "claude" ? tr("by Claude · {t}", { t: s.at || "9:00" }) : "";
  return `<div class="sugg" style="--c:${CALL_COLOR[s.call] || color}">
    <div class="shead"><span>${tr("Today")}${by ? `<small class="sby">${by}</small>` : ""}</span><b class="call">${esc(tr(CALL_LABEL[s.call] || s.call))}</b></div>
    ${s.yesterday ? `<p class="syest"><b>${tr("Yesterday")}</b> ${esc(s.yesterday)}</p>` : ""}
    ${s.reply ? `<p class="swin"><b>${tr("Re: your note")}</b> ${esc(s.reply)}</p>` : ""}
    ${s.win ? `<p class="swin"><b>${tr("Well done")}</b> ${esc(s.win)}</p>` : ""}
    <div class="stitle">${esc(s.headline)}</div>
    ${s.session ? `<div class="ssess">${esc(s.session)}</div>` : ""}
    ${s.why ? `<p>${esc(s.why)}</p>` : ""}
    ${s.form ? `<p class="sform"><b>${tr("Form")}</b> ${esc(s.form)}</p>` : ""}
    ${s.science ? `<p class="ssci"><b>${tr("Why it works")}</b> ${esc(s.science)}</p>` : ""}
    ${s.club ? `<p class="sclub"><b>${tr("Club")}</b> ${esc(s.club)}</p>` : ""}
    ${s.prehab?.length ? `<details class="snum"><summary>${tr("Prehab · 2×/week, ~15 min")}</summary>
      <ul>${s.prehab.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
      <div class="smute">${tr("From recurring form issues in the logged runs. After easy runs or on rest days; stop if anything hurts.")}</div></details>` : ""}
    ${s.numbers?.length ? `<details class="snum"${store.get("numOpen") === "0" ? "" : " open"}><summary>${tr("Numbers")}</summary>
      <ul>${s.numbers.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
      <div class="smute">${tr("VDOT and paces: Jack Daniels' formula. Easy ceiling: 79% of max HR, or 74% of HR reserve when a resting HR is set.")}</div></details>` : ""}
    ${s.next ? `<p class="smute">${tr("Next:")} ${esc(s.next)}</p>` : ""}
  </div>`;
}

function renderToday(p, color) {
  const t = state.today.get(p);
  const today = iso(new Date());
  if (!t || (!t.loading && (t.dirty || t.date !== today || Date.now() - t.at > 30 * 60_000))) queueMicrotask(() => loadToday(p));
  if (t?.suggestion && t.suggestion.date === today) {
    const note = t.newer && !t.refresh?.pending
      ? `<p class="smute">${tr(t.refresh?.left ? "Sessions or target changed since this was written." : "New sessions logged since this was written. They're in tomorrow's 9:00 suggestion.")}</p>` : "";
    return rebuildBox(p, color) + suggestionCard(t.suggestion, color).replace(/<\/div>\s*$/, proposalBox(p, t.suggestion) + note + refreshLine(p, t) + "</div>");
  }
  const msg = !t || t.loading ? tr("Loading today's suggestion…")
    : t.error ? tr("Couldn't load the suggestion: {e}", { e: t.error })
    : tr("Claude writes this every morning at 9:00 from the sessions logged here. Nothing for today yet.");
  return suggestionCard(null, color, msg).replace(/<\/div>\s*$/, (t && !t.loading && !t.error ? refreshLine(p, t) : "") + "</div>");
}

function selfDash(p) {
  const h = state.hist.get(p);
  if (!h?.ready) return null;
  const entries = h.activities.map((a) => ({ date: a.date, type: a.type, min: durMin(a.duration), km: a.type === "run" ? +a.km || 0 : 0 }));
  const have = new Set(entries.map((e) => `${e.date}|${e.type}`));
  const linked = new Set(h.activities.filter((a) => a.week).map((a) => `${a.week}|${a.item}`));
  for (const r of h.logs) {
    const it = planFor(p, r.week).items?.find((i) => i.id === r.item);
    if (!it) continue;
    const date = iso(addDays(fromIso(r.week), it.dayIndex));
    const type = /strength/i.test(it.kind) ? "gym" : "run";
    if (have.has(`${date}|${type}`) || linked.has(`${r.week}|${r.item}`)) continue; // also in My log (maybe another day)
    const planned = +((it.meta || "").match(/(\d+)\s*min/) || [])[1] || 0;
    entries.push({ date, type, min: r.duration ? durMin(r.duration) : planned, km: type === "run" ? +r.km || 0 : 0 });
  }
  const calendar = {}, weekly = new Map();
  for (const e of entries) {
    const c = (calendar[e.date] ||= { gym: null, cardio: [] });
    if (e.type === "gym") c.gym = "gym"; else if (!c.cardio.includes(e.type)) c.cardio.push(e.type);
    const wk = iso(mondayOf(fromIso(e.date)));
    const w = weekly.get(wk) || {};
    w[e.type] = (w[e.type] || 0) + e.min;
    w.km = (w.km || 0) + e.km;
    w.n = (w.n || 0) + 1;
    weekly.set(wk, w);
  }
  const weeks = [];
  for (let i = 11; i >= 0; i--) { const wk = iso(addDays(mondayOf(new Date()), -7 * i)); weeks.push({ week: wk, ...(weekly.get(wk) || {}) }); }
  return { dataThrough: iso(new Date()), calendar, weekly: weeks };
}

let showAllActs = null;
function renderSelfLog(p, color) {
  queueMicrotask(() => loadHist(p)); // no-op while fresh
  const h = state.hist.get(p);
  const acts = h?.activities || [];
  const shown = showAllActs === p ? acts : acts.slice(0, 5);
  const list = shown.map((a) => `<button class="act" data-act="${a.id}">
      <span class="adot" style="background:${WGW_COLORS[a.type] || WGW_COLORS.other}"></span>
      <span class="abody"><b>${esc(a.title || tr(a.type))}</b><small>${esc(actDate(a.date))}${actLine(a) ? " · " + esc(actLine(a)) : ""}</small></span>
    </button>`).join("");
  let html = `<div class="section secrow"><span>${tr("My log")}</span><button class="addact" data-addact>${tr("+ Add activity")}</button></div>
    <div class="acts">${list || `<div class="cmute">${tr(h?.ready ? "Nothing added yet. Add runs, gym or swims here — on or off the plan, past sessions too." : "Loading…")}</div>`}
    ${acts.length > 5 ? `<button class="more" data-moreacts>${showAllActs === p ? tr("Show fewer") : tr("Show all {n}", { n: acts.length })}</button>` : ""}</div>`;
  const g = selfDash(p);
  if (g) html += renderDash(g, { note: tr("From what's logged here: ticked plan sessions plus added activities.") });
  if (h?.ready) html += renderCharts(p, color);
  return html;
}

// ── Charts (TJH/SJH): aerobic efficiency, pace vs HR, the goal. Data from public/charts.js ──
/** The runner's runs, each once: My log runs plus ticked sessions with details that aren't in My log. */
function runsOf(p) {
  const h = state.hist.get(p);
  if (!h) return [];
  const runs = h.activities.filter((a) => a.type === "run");
  const have = new Set(runs.map((a) => a.date)), linked = new Set(runs.filter((a) => a.week).map((a) => `${a.week}|${a.item}`));
  for (const r of h.logs) {
    const it = planFor(p, r.week).items?.find((i) => i.id === r.item);
    if (!it || /strength/i.test(it.kind) || !r.km || !r.duration || linked.has(`${r.week}|${r.item}`)) continue;
    const date = iso(addDays(fromIso(r.week), it.dayIndex));
    if (!have.has(date)) runs.push({ date, km: r.km, duration: r.duration, hr: r.hr, title: it.title });
  }
  return runs;
}
const md2 = (d) => `${+d.slice(5, 7)}-${+d.slice(8)}`;
const dayN = (d) => Date.parse(d + "T00:00:00Z") / 864e5;
// One SVG plot frame: 320×150 user units, scales to the card width. y ticks on the left, light grid.
function frame(x0, x1, y0, y1, { invert = false, yFmt = (v) => v, yTicks = 3 } = {}) {
  const W = 320, H = 150, L = 38, R = 8, T = 10, B = 22;
  const sx = (v) => L + ((v - x0) / (x1 - x0 || 1)) * (W - L - R);
  const sy = (v) => { const f = (v - y0) / (y1 - y0 || 1); return invert ? T + f * (H - T - B) : H - B - f * (H - T - B); };
  let grid = "";
  for (let i = 0; i <= yTicks - 1; i++) {
    const v = y0 + ((y1 - y0) * i) / (yTicks - 1), y = sy(v);
    grid += `<line class="cg" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="ct" x="${L - 5}" y="${y + 3}" text-anchor="end">${yFmt(v)}</text>`;
  }
  return { W, H, L, R, T, B, sx, sy, grid };
}
const dot = (x, y, tip) => `<g class="cd"><circle class="chit" cx="${x}" cy="${y}" r="10"/><circle class="cdot" cx="${x}" cy="${y}" r="4"/><title>${esc(tip)}</title></g>`;
const chartCard = (title, sub, svg, rows, head) => `<div class="chart"><div class="chh"><b>${title}</b><span>${sub}</span></div>
  <svg viewBox="0 0 320 150" role="img" aria-label="${esc(title)}">${svg}</svg>
  <details class="ctab"><summary>${tr("Table")}</summary><table><tr>${head.map((x) => `<th>${x}</th>`).join("")}</tr>
    ${rows.map((r) => `<tr>${r.map((x) => `<td>${esc(String(x))}</td>`).join("")}</tr>`).join("")}</table></details></div>`;

function renderCharts(p, color) {
  const today = iso(new Date());
  const c = chartData(runsOf(p), today, state.goals[p] || null);
  let out = "";
  if (c.eff) {
    const pts = c.eff.points, xs = pts.map((q) => dayN(q.date)), vs = pts.map((q) => q.v);
    const lo = Math.floor((Math.min(...vs) - 0.05) * 20) / 20, hi = Math.ceil((Math.max(...vs) + 0.05) * 20) / 20;
    const f = frame(Math.min(...xs), Math.max(...xs), lo, hi, { yFmt: (v) => v.toFixed(2) });
    const line = pts.map((q, i) => `${i ? "L" : "M"}${f.sx(dayN(q.date)).toFixed(1)},${f.sy(q.v).toFixed(1)}`).join("");
    const tr2 = c.eff.trend ? `<line class="ctrend" x1="${f.sx(xs[0])}" y1="${f.sy(c.eff.trend.from)}" x2="${f.sx(xs[xs.length - 1])}" y2="${f.sy(c.eff.trend.to)}"/>` : "";
    const svg = f.grid + tr2 + `<path class="cline" d="${line}"/>` +
      pts.map((q) => dot(f.sx(dayN(q.date)), f.sy(q.v), `${md2(q.date)} · ${q.v} m/beat · ${q.pace}/km · HR ${q.hr} · ${q.km} km`)).join("") +
      `<text class="ct" x="${f.L}" y="${f.H - 6}">${md2(pts[0].date)}</text><text class="ct" x="${f.W - f.R}" y="${f.H - 6}" text-anchor="end">${md2(pts[pts.length - 1].date)}</text>`;
    const t = c.eff.trend ? ` ${tr("Trend {v} per 4 weeks.", { v: (c.eff.trend.per4w >= 0 ? "+" : "") + c.eff.trend.per4w.toFixed(2) })}` : "";
    out += chartCard(tr("Aerobic efficiency · easy runs"), tr("Metres per heartbeat on runs at HR ≤ {n}. Higher = fitter.", { n: c.eff.ceil }) + t, svg,
      pts.map((q) => [md2(q.date), q.v, q.pace, q.hr, q.km]), [tr("Date"), "m/beat", tr("Pace"), "HR", "km"]);
  }
  if (c.scatter) {
    const pts = c.scatter.points, hrs = pts.map((q) => q.hr), ps = pts.map((q) => q.pace);
    const x0 = Math.min(...hrs, c.scatter.ceil || 999) - 5, x1 = Math.max(...hrs, c.scatter.ceil || 0) + 5;
    const y0 = Math.floor(Math.min(...ps) / 30) * 30, y1 = Math.ceil(Math.max(...ps) / 30) * 30;
    const f = frame(x0, x1, y0, y1, { invert: true, yFmt: (v) => mmss(v) });
    const ceil = c.scatter.ceil ? `<line class="cref" x1="${f.sx(c.scatter.ceil)}" x2="${f.sx(c.scatter.ceil)}" y1="${f.T}" y2="${f.H - f.B}"/>
      <text class="ct cl" x="${f.sx(c.scatter.ceil) - 4}" y="${f.T + 9}" text-anchor="end">${tr("easy ≤ {n}", { n: c.scatter.ceil })}</text>` : "";
    const svg = f.grid + ceil + pts.map((q) => dot(f.sx(q.hr), f.sy(q.pace), `${md2(q.date)} · ${q.paceText}/km · HR ${q.hr} · ${q.km} km`)).join("") +
      `<text class="ct" x="${f.L}" y="${f.H - 6}">HR ${Math.round(x0)}</text><text class="ct" x="${f.W - f.R}" y="${f.H - 6}" text-anchor="end">HR ${Math.round(x1)}</text>`;
    out += chartCard(tr("Pace vs heart rate"), tr("Every run, last 120 days. Faster pace is higher; dots right of the line weren't easy."), svg,
      pts.map((q) => [md2(q.date), q.paceText, q.hr, q.km]), [tr("Date"), tr("Pace"), "HR", "km"]);
  }
  if (c.goal?.kind === "long") {
    const g = c.goal, step = Math.max(g.target, ...g.bars.map((b) => b.km)) > 30 ? 10 : 5;
    const top = Math.ceil((Math.max(g.target, ...g.bars.map((b) => b.km)) + 1) / step) * step;
    const f = frame(0, g.bars.length, 0, top, { yFmt: (v) => `${Math.round(v)}`, yTicks: top / step + 1 });
    const bw = (f.W - f.L - f.R) / g.bars.length;
    const bars = g.bars.map((b, i) => {
      if (!b.km) return "";
      const x = f.sx(i) + 1, y = f.sy(b.km), h = f.sy(0) - y, w = bw - 2, r = Math.min(4, h, w / 2);
      return `<g class="cd"><path class="cbar" d="M${x},${f.sy(0)}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${f.sy(0)}Z"/><title>${tr("Week of {d}", { d: md2(b.week) })} · ${b.km} km</title></g>`;
    }).join("");
    const ty = f.sy(g.target);
    const svg = f.grid + bars + `<line class="cref" x1="${f.L}" x2="${f.W - f.R}" y1="${ty}" y2="${ty}"/>
      <text class="ct cl" x="${f.L + 3}" y="${ty - 4}">${g.target} km${g.date ? ` · ${md2(g.date)}` : ""}</text>
      <text class="ct" x="${f.L}" y="${f.H - 6}">${md2(g.bars[0].week)}</text><text class="ct" x="${f.W - f.R}" y="${f.H - 6}" text-anchor="end">${tr("this week")}</text>`;
    out += chartCard(tr("Long run toward the race"), tr("Longest run each week vs the race distance."), svg,
      g.bars.map((b) => [md2(b.week), b.km || "—"]), [tr("Week"), "km"]);
  } else if (c.goal?.kind === "time") {
    const g = c.goal, xs = g.points.map((q) => dayN(q.date)), ts = g.points.map((q) => q.t).concat(g.target ? [g.target] : []);
    const y0 = Math.floor(Math.min(...ts) / 60) * 60 - 60, y1 = Math.ceil(Math.max(...ts) / 60) * 60 + 60;
    const f = frame(Math.min(...xs) - 1, Math.max(...xs) + 1, y0, y1, { invert: true, yFmt: (v) => mmss(v) });
    const gl = g.target ? `<line class="cref" x1="${f.L}" x2="${f.W - f.R}" y1="${f.sy(g.target)}" y2="${f.sy(g.target)}"/>
      <text class="ct cl" x="${f.L + 3}" y="${f.sy(g.target) - 4}">${tr("goal {t}", { t: mmss(g.target) })}</text>` : "";
    const svg = f.grid + gl + g.points.map((q) => dot(f.sx(dayN(q.date)), f.sy(q.t), `${md2(q.date)} · ${q.time} for ${g.km} km (${q.km} km run)`)).join("") +
      `<text class="ct" x="${f.L}" y="${f.H - 6}">${md2(g.points[0].date)}</text><text class="ct" x="${f.W - f.R}" y="${f.H - 6}" text-anchor="end">${md2(g.points[g.points.length - 1].date)}</text>`;
    out += chartCard(tr("{k} km times", { k: g.km }), tr("Runs of about {k} km, timed over {k} km. Faster is higher.", { k: g.km }), svg,
      g.points.map((q) => [md2(q.date), q.time, q.km]), [tr("Date"), tr("Time"), "km"]);
  }
  return out ? `<div class="section">${tr("Charts")}</div><div class="charts" style="--c:${color}">${out}</div>` : "";
}

// Additional fields (stored in activities.extra; the server validates the same keys).
const EXTRA_FIELDS = [
  ["max_hr", "Max HR", "bpm", "176", "numeric"],
  ["vert_osc_cm", "Vertical oscillation", "cm", "8.2", "decimal"],
  ["stride_m", "Avg stride", "m", "1.01", "decimal"],
  ["gct_ms", "Ground contact", "ms", "245", "numeric"],
  ["lr_balance", "L/R balance", "left %", "49.8", "decimal"],
  ["power_w", "Avg power", "W", "180", "numeric"],
  ["elev_m", "Elevation gain", "m", "12", "numeric"],
  ["training_load", "Training load", "", "120", "numeric"],
  ["start", "Start time", "hh:mm", "06:30", "numeric"],
  ["weather", "Weather", "", "28°C humid", "text", false, 30],
  ["splits", "Km splits", "", "5:45 5:40 5:38", "numeric", true, 200],
  ["split_hr", "Split HR", "", "150 156 160", "numeric", true, 120],
];
function renderExtraFields() {
  const vals = Object.fromEntries(EXTRA_FIELDS.map(([k]) => [k, $(`#ax_${k}`)?.value || ""]));
  $("#aExtra").innerHTML = EXTRA_FIELDS.map(([k, label, unit, ph, mode, full, max]) =>
    `<label${full ? ' class="span2"' : ""}>${tr(label)}${unit ? ` <span>${tr(unit)}</span>` : ""}<input id="ax_${k}" inputmode="${mode}" placeholder="${ph}"${max ? ` maxlength="${max}"` : ""} value="${esc(vals[k])}"></label>`).join("");
}
renderExtraFields();
const parseExtra = (a) => { try { return a?.extra ? JSON.parse(a.extra) : {}; } catch { return {}; } };
function extraCount() { return EXTRA_FIELDS.filter(([k]) => $(`#ax_${k}`).value.trim()).length; }
function updateExtraSummary() { const n = extraCount(); $("#aExtraN").textContent = n ? tr("{n} filled", { n }) : tr("optional"); }

// Add / edit activity sheet
const act = { open: false, p: null, id: null, busy: false, paceTouched: false, link: null, shots: [], shotFilled: new Set() };
/** opts.link {week, item}: the plan session this activity holds the details of; opts.prefill: field values. */
function openAct(p, a = null, opts = {}) {
  for (const sh of act.shots) if (sh.url) URL.revokeObjectURL(sh.url);
  Object.assign(act, { open: true, p, id: a?.id || null, paceTouched: !!a?.pace, shotFilled: new Set(),
    link: opts.link || (a?.week && a?.item ? { week: a.week, item: a.item } : null),
    shots: a?.photo_idx ? String(a.photo_idx).split(",").map((i) => ({ idx: Number(i), existing: true })) : [] });
  a = a || opts.prefill || null;
  $("#actKind").textContent = `${p} · ${tr(act.id ? "Edit activity" : "New activity")}`;
  $("#aDate").value = a?.date || iso(new Date());
  $("#aDate").max = iso(new Date());
  $("#aType").value = a?.type || "run";
  $("#aTitle").value = a?.title || "";
  $("#aKm").value = a?.km ?? "";
  $("#aTime").value = a?.duration || "";
  $("#aPace").value = a?.pace || "";
  $("#aHr").value = a?.hr ?? "";
  $("#aCad").value = a?.cadence ?? "";
  $("#aNote").value = a?.note || "";
  const x = parseExtra(a);
  for (const [k] of EXTRA_FIELDS) $(`#ax_${k}`).value = x[k] ?? "";
  $("#aMore").open = extraCount() > 0;
  updateExtraSummary();
  $("#aDelete").hidden = !act.id;
  if (act.link) $("#actKind").textContent += ` · ✓ ${tr("plan session")}`;
  renderShots();
  $("#actSheet").classList.add("show");
  document.body.classList.add("noscroll");
}
function closeAct() {
  act.open = false;
  $("#actSheet").classList.remove("show");
  document.body.classList.remove("noscroll");
}
function actAutoPace() {
  if (act.paceTouched) return;
  const km = parseFloat($("#aKm").value.replace(",", "."));
  const t = normTime($("#aTime").value);
  $("#aPace").value = km > 0 && t ? fmtPace(toSec(t) / km) : "";
}
async function saveAct(e) {
  e.preventDefault();
  if (act.busy) return;
  const duration = normTime($("#aTime").value);
  const pace = normTime($("#aPace").value, { pace: true });
  const km = $("#aKm").value.trim().replace(",", ".");
  if (km && !(parseFloat(km) > 0)) return toast(tr("Distance should be a number of km"));
  if (duration === null) return toast(tr("Time should look like 32:10 or 1:02:30"));
  if (pace === null) return toast(tr("Pace should look like 5:40"));
  act.busy = true;
  try {
    const r = await api("/api/activities", { method: "POST", body: JSON.stringify({
      person: act.p, id: act.id, date: $("#aDate").value, type: $("#aType").value, title: $("#aTitle").value.trim(),
      km, duration, pace, hr: $("#aHr").value.trim(), cadence: $("#aCad").value.trim(), note: $("#aNote").value.trim(),
      extra: Object.fromEntries(EXTRA_FIELDS.map(([k]) => [k, $(`#ax_${k}`).value.trim()]).filter(([, v]) => v)),
      week: act.link?.week || null, item: act.link?.item || null, today: iso(new Date()),
    }) });
    if (r.row) { state.logs.set(`${act.p}|${r.row.week}|${r.row.item}`, r.row); doneSet(act.p, r.row.week).add(r.row.item); }
    const activity = await syncShots(r.activity);
    const h = state.hist.get(act.p) || { activities: [], logs: [], ready: true };
    h.activities = [activity, ...h.activities.filter((a) => a.id !== activity.id)]
      .sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : b.id - a.id));
    state.hist.set(act.p, h);
    dataChanged(act.p);
    refresh(); // the server may have ticked or un-ticked a plan session it matched
    closeAct();
    render();
    toast(tr("Saved ✓"));
  } catch (err) {
    toast(tr("Couldn't save: {e}", { e: err.message }));
  } finally { act.busy = false; }
}
async function deleteAct() {
  if (!act.id || !confirm(tr("Delete this activity?"))) return;
  try {
    await api(`/api/activities?person=${act.p}&id=${act.id}&today=${iso(new Date())}`, { method: "DELETE" });
    const h = state.hist.get(act.p);
    if (h) h.activities = h.activities.filter((a) => a.id !== act.id);
    dataChanged(act.p);
    refresh(); // the server may have ticked or un-ticked a plan session it matched
    closeAct();
    render();
  } catch (err) { toast(tr("Couldn't delete: {e}", { e: err.message })); }
}
// Screenshots in Add activity: up to 3, each read separately and merged into the form, kept with the activity.
const MAX_SHOTS = 3;
const shotUrl = (p, id, idx) => `/api/actphoto?person=${p}&id=${id}&idx=${idx}`;
const shotBlobs = new Map(); // "p|id|idx" -> objectURL of a stored photo
function renderShots() {
  const live = act.shots.filter((x) => !x.removed);
  const thumbs = live.map((x) => {
    const k = x.existing ? `${act.p}|${act.id}|${x.idx}` : null;
    const src = x.url || (k && shotBlobs.get(k));
    if (k && !src) queueMicrotask(() => loadShot(act.p, act.id, x.idx));
    return `<div class="shot">${src ? `<img src="${src}" alt="">` : `<div class="ph">…</div>`}
      ${x.reading ? `<span class="shotbusy">${tr("Reading…")}</span>` : ""}
      <button type="button" class="shotx" data-shot="${act.shots.indexOf(x)}" aria-label="${tr("Remove")}">✕</button></div>`;
  }).join("");
  const add = live.length < MAX_SHOTS ? `<label class="addphoto shotadd"><input type="file" accept="image/*" id="aShot" multiple hidden>
    <span>${tr(live.length ? "+ Add screenshot ({n}/{m})" : "📷 Pick or paste watch screenshots (up to {m})", { n: live.length, m: MAX_SHOTS })}</span></label>` : "";
  $("#aShots").innerHTML = (thumbs ? `<div class="shots">${thumbs}</div>` : "") + add;
}
async function loadShot(p, id, idx) {
  const k = `${p}|${id}|${idx}`;
  if (shotBlobs.has(k)) return;
  shotBlobs.set(k, "");
  const res = await request(shotUrl(p, id, idx));
  if (!res.ok) return;
  shotBlobs.set(k, URL.createObjectURL(await res.blob()));
  if (act.open && act.p === p && act.id === id) renderShots();
}
/** Add picked/pasted/dropped images (up to 3 in all), then read each one into the form. */
async function addShots(files) {
  const room = MAX_SHOTS - act.shots.filter((x) => !x.removed).length;
  const list = [...files].filter((f) => /^image\//.test(f.type));
  if (list.length > room) toast(tr("Up to {m} screenshots per activity", { m: MAX_SHOTS }));
  const added = [];
  for (const f of list.slice(0, Math.max(room, 0))) {
    try {
      const blob = await compress(f);
      const sh = { blob, url: URL.createObjectURL(blob), reading: true };
      act.shots.push(sh); added.push(sh);
    } catch (e) { toast(e.message); }
  }
  renderShots();
  for (const sh of added) { // one at a time: AI providers rate-limit bursts
    await readShot(sh);
    sh.reading = false;
    if (act.open) renderShots();
  }
}
async function readShot(sh) {
  try {
    const r = await api(`/api/extract?person=${act.p}`, { method: "POST", body: sh.blob, headers: { "content-type": "image/jpeg" } });
    const filled = [];
    // A field one screenshot filled isn't overwritten by the next (screens repeat summary values, often rounded).
    const set = (id, v) => {
      if (v == null || v === "" || act.shotFilled.has(id)) return;
      $(id).value = v; filled.push(id); act.shotFilled.add(id);
    };
    set("#aDate", r.date && r.date <= iso(new Date()) && !act.link ? r.date : null);
    set("#aType", act.link ? null : r.type); set("#aKm", r.km); set("#aTime", r.duration);
    if (!$("#aTitle").value.trim()) set("#aTitle", r.title); // keep a title the runner already typed
    set("#aHr", r.hr); set("#aCad", r.cadence);
    let nx = 0;
    for (const [k] of EXTRA_FIELDS) if (r.extra?.[k] != null && r.extra[k] !== "" && !act.shotFilled.has(`#ax_${k}`)) { set(`#ax_${k}`, r.extra[k]); nx++; }
    if (nx) $("#aMore").open = true;
    updateExtraSummary();
    if (r.pace && !act.shotFilled.has("#aPace")) { set("#aPace", r.pace); act.paceTouched = true; } else actAutoPace();
    for (const id of filled) { const el = $(id); el.classList.add("justfilled"); setTimeout(() => el.classList.remove("justfilled"), 1800); }
    const notes = (r.notes || []).map((x) => tr(x)).join("; ");
    toast(filled.length ? tr("Filled {n} fields — check & Save", { n: filled.length }) + (notes ? ` (${notes})` : "")
      : tr("No new stats in that screenshot"));
  } catch (err) { toast(err.message); }
}
/** After the activity is saved: delete removed photos, upload new ones into free slots. Returns the activity. */
async function syncShots(a) {
  const used = new Set(), jobs = [];
  for (const x of act.shots) {
    if (x.existing && x.removed) jobs.push(api(shotUrl(act.p, a.id, x.idx), { method: "DELETE" }));
    else if (x.existing) used.add(x.idx);
  }
  for (const x of act.shots.filter((y) => !y.existing && !y.removed)) {
    const idx = [0, 1, 2].find((i) => !used.has(i));
    if (idx == null) break;
    used.add(idx);
    jobs.push(api(shotUrl(act.p, a.id, idx), { method: "PUT", body: x.blob, headers: { "content-type": "image/jpeg" } })
      .then(() => shotBlobs.set(`${act.p}|${a.id}|${idx}`, x.url)));
  }
  const res = await Promise.allSettled(jobs);
  if (res.some((r) => r.status === "rejected")) toast(tr("Saved, but a screenshot didn't upload"));
  return { ...a, photo_idx: [...used].sort().join(",") || null };
}

// Weekly totals per runner: WGW from Garmin (wgw.json, minutes only), others from what they log here.
const MIN_TYPES = ["gym", "run", "swim", "bike", "hike", "other"];
function weekTotals(pid, wk) {
  if (pid === "WGW") {
    const w = state.wgw?.weekly.find((x) => x.week === wk);
    return w ? { min: MIN_TYPES.reduce((a, t) => a + (w[t] || 0), 0), w } : state.wgw ? { min: 0, w: {} } : null;
  }
  const g = selfDash(pid);
  if (!g) return null;
  const w = g.weekly.find((x) => x.week === wk) || {};
  return { min: MIN_TYPES.reduce((a, t) => a + (w[t] || 0), 0), km: w.km || 0, n: w.n || 0, w };
}
function todayOf(pid) {
  if (pid === "WGW") { const s = state.wgw?.suggestion; return s?.date === iso(new Date()) ? s : null; }
  const t = state.today.get(pid);
  if (!t || (!t.loading && t.date !== iso(new Date()))) queueMicrotask(() => loadToday(pid));
  return t?.suggestion?.date === iso(new Date()) ? t.suggestion : null;
}

// All tab: the 7 days of a week per runner, planned sessions (status) + training beyond the plan.
const wgwActs = () => Object.entries(state.wgw?.calendar || {}).flatMap(([d, c]) => [
  ...(c.gym ? [{ id: `${d}|gym`, date: d, type: "gym" }] : []), ...(c.cardio || []).map((t) => ({ id: `${d}|${t}`, date: d, type: t }))]);
function boardWeek(pid, w) {
  if (planFor(pid, w).empty) return null;
  const acts = pid === "WGW" ? wgwActs() : state.hist.get(pid)?.activities || [];
  // WGW doesn't tick on the site: their sessions count as done from the Garmin calendar (same matching as the server).
  return weekDays(pid, w, doneSet(pid, w), acts, iso(new Date()), state.planChanges, pid === "WGW");
}
const typeColor = (t) => (t === "gym" ? WGW_COLORS.pull : WGW_COLORS[t] || WGW_COLORS.other);
function weekStrip(b) {
  const today = iso(new Date());
  return `<div class="wk7">${b.days.map((d) => `<div class="wd${d.date === today ? " today" : ""}"><span>${tr(d.name)}</span>
    ${d.planned.map((x) => `<i class="wp ${x.status}" title="${esc(x.title)}${x.moved ? " ↷" : ""}"></i>`).join("")}
    ${d.extra.map((t) => `<i class="wx" style="--k:${typeColor(t)}" title="${esc(tr(t))}">+</i>`).join("")}</div>`).join("")}</div>
    <div class="wsum">${b.active === 1 ? tr("1 day trained") : tr("{n} days trained", { n: b.active })}${b.extra ? ` · ${tr("{n} beyond the plan", { n: b.extra })}` : ""}</div>`;
}

function renderBoard() {
  const w = state.week, isCur = w === thisWeek();
  for (const p of PEOPLE) if (p.id !== "WGW") queueMicrotask(() => loadHist(p.id));
  let html = `<div class="section">${isCur ? tr("This week") : tr("Week of {d}", { d: md(fromIso(w)) })}</div>`;

  for (const p of PEOPLE) {
    const s = summary(p.id, w), b = s ? boardWeek(p.id, w) : null;
    const tot = weekTotals(p.id, w);
    const sug = isCur ? todayOf(p.id) : null;
    const pct = b && b.total ? b.done / b.total : 0;
    html += `<button class="pcard" data-goto="${p.id}" style="--c:${p.color}">
      <div class="top"><span class="name"><i style="background:${p.color}"></i>${p.id}</span>
        <span class="cnt">${b ? `${b.done}<small>/${b.total}</small>${b.extra ? `<em>+${b.extra}</em>` : ""}` : "—"}</span></div>
      <div class="blurb">${esc(s ? s.plan.title : p.blurb)}</div>`;
    if (b) {
      html += `<div class="progress"><div class="track"><div class="fill" style="width:${pct * 100}%;background:${pct === 1 ? "var(--ok)" : p.color}"></div></div></div>
        ${weekStrip(b)}`;
    } else {
      html += `<div class="blurb" style="margin-top:6px">${esc(tr(planFor(p.id, w).empty))}</div>`;
    }
    if (tot && tot.min) {
      const parts = MIN_TYPES.filter((t) => tot.w[t]).map((t) =>
        `<span><i style="background:${t === "gym" ? WGW_COLORS.pull : WGW_COLORS[t]}"></i>${tr(t)} ${tot.w[t]}′</span>`).join("");
      html += `<div class="bweek"><b>${tot.min}′</b>${tot.km ? ` · ${tr("{n} km run", { n: Math.round(tot.km * 10) / 10 })}` : ""}${parts}</div>`;
    }
    if (sug) {
      const ls = localized(sug);
      html += `<div class="btoday" style="--k:${CALL_COLOR[ls.call] || p.color}"><b>${esc(tr(CALL_LABEL[ls.call] || ls.call))}</b>${esc(ls.headline)}</div>`;
    }
    html += `</button>`;
  }

  const weeks = [];
  for (let i = HISTORY_WEEKS - 1; i >= 0; i--) weeks.push(iso(addDays(fromIso(w), -7 * i)));
  html += `<div class="section">${tr("Last {n} weeks", { n: HISTORY_WEEKS })}</div>
    <table class="hist"><tr><th></th>${weeks.map((wk) => `<th>${md(fromIso(wk))}</th>`).join("")}</tr>`;
  for (const p of PEOPLE) {
    html += `<tr><td>${p.id}</td>`;
    for (const wk of weeks) {
      const b = summary(p.id, wk) ? boardWeek(p.id, wk) : null;
      const tot = weekTotals(p.id, wk);
      const mins = tot && tot.min ? `<small>${tot.min}′</small>` : "";
      if (!b || !state.loaded.has(wk)) {
        html += `<td><div class="cell" style="color:var(--mute)">${mins ? `<span>—</span>${mins}` : "—"}</div></td>`;
        continue;
      }
      const f = b.total ? b.done / b.total : 0;
      const alpha = Math.round((0.15 + 0.85 * f) * 255).toString(16).padStart(2, "0");
      const bg = f === 0 ? "var(--card)" : p.color + alpha;
      const fg = f >= 0.6 ? "#0f1115" : "var(--text)";
      html += `<td><div class="cell" style="background:${bg};color:${fg}"><span>${Math.round(f * 100)}%${b.extra ? `<sup>+${b.extra}</sup>` : ""}</span>${mins}</div></td>`;
    }
    html += `</tr>`;
  }
  html += `</table><div class="legend">${tr("Top: share of planned sessions done (+ sessions beyond the plan). Below: training minutes that week (WGW from Garmin; TJH and SJH from what they log). Tap a runner to open their week.")}</div>`;
  return html;
}

function render() {
  renderHeader();
  $("#main").innerHTML = state.tab === "board" ? renderBoard() : renderPerson(state.tab);
  const cs = $("#dashCal"); if (cs) cs.scrollLeft = cs.scrollWidth;
  $("#status").textContent = !state.online
    ? tr("Offline — changes may not be saved")
    : state.lastSync ? tr("Synced {t}", { t: state.lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }) : tr("Loading…");
}

// ── log sheet ────────────────────────────────────────────────────────────────
const sheet = { p: null, w: null, item: null, paceTouched: false, busy: false };
const photoUrls = new Map(); // "p|w|item|updated_at" -> objectURL

function openSheet(p, w, it) {
  Object.assign(sheet, { p, w, item: it.id, it, paceTouched: false });
  const l = logOf(p, w, it.id) || {};
  $("#logKind").textContent = `${p} · ${tr(DAYS[it.dayIndex])} · ${tKind(it.kind)}`;
  $("#logKind").style.color = it.color || "var(--mute)";
  $("#logTitle").textContent = it.title;
  $("#fKm").value = l.km ?? "";
  $("#fTime").value = l.duration ?? "";
  $("#fPace").value = l.pace ?? "";
  $("#fHr").value = l.hr ?? "";
  $("#fNote").value = l.note ?? "";
  sheet.paceTouched = !!l.pace;
  renderPhoto();
  $("#logSheet").classList.add("show");
  document.body.classList.add("noscroll");
}
function closeSheet() {
  $("#logSheet").classList.remove("show");
  document.body.classList.remove("noscroll");
  sheet.item = null;
}

/** TJH/SJH: the activity in My log holding this session's full details, if there is one. */
const linkedAct = (p, w, item) => state.hist.get(p)?.activities.find((a) => a.week === w && a.item === item) || null;
const SELF_LOG = new Set(["TJH", "SJH"]);
function detailsButton(p, w, item) {
  if (!SELF_LOG.has(p)) return "";
  return linkedAct(p, w, item)
    ? `<button type="button" class="detailsbtn" id="fDetails">${tr("📋 Full details & screenshots (in My log)")}</button>`
    : `<label class="addphoto"><input type="file" accept="image/*" id="fShots" multiple hidden>${tr("📷 Screenshots (up to 3) → full details in My log")}</label>
       <button type="button" class="ghost linkbtn" id="fDetails">${tr("Full details without a screenshot")}</button>`;
}
/** Open Add activity linked to the open session, prefilled from the plan and the quick fields above. */
function openLinked(files) {
  const { p, w, item, it } = sheet;
  const a = linkedAct(p, w, item);
  const type = /strength/i.test(it.kind) ? "gym" : /swim/i.test(it.kind) ? "swim" : "run";
  const quick = { km: $("#fKm").value.trim(), duration: normTime($("#fTime").value) || "", pace: $("#fPace").value.trim(),
    hr: $("#fHr").value.trim(), note: $("#fNote").value.trim() };
  const prefill = { date: iso(addDays(fromIso(w), it.dayIndex)), type,
    title: it.title.replace(/[^\p{L}\p{N} .,:;'’()+\-–—/×%°·~&!?]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40), ...quick };
  closeSheet();
  if (a) {
    // Quick fields typed just now win over the stored ones.
    const merged = { ...a, ...Object.fromEntries(Object.entries(quick).filter(([, v]) => v)) };
    openAct(p, merged);
  } else openAct(p, null, { link: { week: w, item }, prefill });
  if (files?.length) addShots(files);
}

async function renderPhoto() {
  const { p, w, item } = sheet;
  const l = logOf(p, w, item) || {};
  const box = $("#photoBox");
  if (SELF_LOG.has(p) && !l.has_photo) { box.innerHTML = detailsButton(p, w, item); return; }
  if (!l.has_photo) {
    box.innerHTML = `<label class="addphoto"><input type="file" accept="image/*" id="fPhoto" hidden>
      ${tr("📷 Add photo or watch screenshot")}</label>`;
    return;
  }
  box.innerHTML = `<div class="thumb"><div class="ph">${tr("Loading photo…")}</div></div>
    <div class="photobtns"><button type="button" id="fExtract">${tr("✨ Fill from screenshot")}</button><button type="button" id="fRemove" class="ghost">${tr("Remove")}</button></div>
    ${detailsButton(p, w, item)}`;
  const k = `${p}|${w}|${item}|${l.updated_at}`;
  if (!photoUrls.has(k)) {
    const res = await request(`/api/photo?${qsKey(p, w, item)}`);
    if (!res.ok) { box.querySelector(".thumb").innerHTML = `<div class="ph">${tr("Photo unavailable")}</div>`; return; }
    photoUrls.set(k, URL.createObjectURL(await res.blob()));
  }
  if (sheet.item !== item) return;
  box.querySelector(".thumb").innerHTML = `<img src="${photoUrls.get(k)}" alt="Session photo">`;
}

const MAX_ASPECT = 3; // height:width (either way); ~1.5 phone screens
async function compress(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const w = img.naturalWidth, h = img.naturalHeight;
    // Long scrolling captures shrink until the text is unreadable for the model: refuse them.
    if (Math.max(w, h) / Math.min(w, h) > MAX_ASPECT) throw new Error(tr("That image is too long to read. Crop it, or split it into up to 3 screenshots."));
    // Pixel budget (not longest side), so a tall phone screenshot keeps a readable width.
    const scale = Math.min(1, Math.sqrt(2_400_000 / (w * h)));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    let q = 0.82, blob;
    do { blob = await new Promise((r) => c.toBlob(r, "image/jpeg", q)); q -= 0.12; } while (blob.size > 1_200_000 && q > 0.3);
    return blob;
  } finally { URL.revokeObjectURL(url); }
}

async function uploadPhoto(file) {
  const { p, w, item } = sheet;
  $("#photoBox").innerHTML = `<div class="thumb"><div class="ph">${tr("Uploading…")}</div></div>`;
  try {
    const blob = await compress(file);
    const r = await api(`/api/photo?${qsKey(p, w, item)}`, { method: "PUT", body: blob, headers: { "content-type": "image/jpeg" } });
    const l = logOf(p, w, item) || { person: p, week: w, item };
    state.logs.set(`${p}|${w}|${item}`, { ...l, has_photo: 1, updated_at: r.updated_at });
    render();
    await renderPhoto();
    toast(tr("Photo saved — tap ✨ to read stats from it"));
  } catch (e) {
    toast(tr("Upload failed: {e}", { e: e.message }));
    renderPhoto();
  }
}

function autoPace() {
  if (sheet.paceTouched) return;
  const km = parseFloat($("#fKm").value.replace(",", "."));
  const t = normTime($("#fTime").value);
  $("#fPace").value = km > 0 && t ? fmtPace(toSec(t) / km) : "";
}

async function saveSheet(e) {
  e.preventDefault();
  if (sheet.busy) return;
  const { p, w, item } = sheet;
  const km = $("#fKm").value.trim().replace(",", ".");
  const duration = normTime($("#fTime").value);
  const pace = normTime($("#fPace").value, { pace: true });
  const hr = $("#fHr").value.trim();
  if (km && !(parseFloat(km) > 0)) return toast(tr("Distance should be a number of km"));
  if (duration === null) return toast(tr("Time should look like 32:10 or 1:02:30"));
  if (pace === null) return toast(tr("Pace should look like 5:40"));
  if (hr && !(+hr >= 40 && +hr <= 230)) return toast(tr("Heart rate should be 40–230"));
  sheet.busy = true;
  try {
    const r = await api("/api/progress", {
      method: "POST",
      body: JSON.stringify({ person: p, week: w, item, done: true, log: { km, duration, pace, hr, note: $("#fNote").value.trim() } }),
    });
    doneSet(p, w).add(item);
    state.logs.set(`${p}|${w}|${item}`, r.row);
    dataChanged(p);
    closeSheet();
    render();
    toast(tr("Saved ✓"));
  } catch (err) {
    toast(tr("Couldn't save: {e}", { e: err.message }));
  } finally { sheet.busy = false; }
}

// ── UI wiring ────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}
function showLock() {
  $("#lock").classList.add("show");
  setTimeout(() => $("#lockInput").focus(), 50);
}
$("#lockForm").addEventListener("submit", (e) => {
  e.preventDefault();
  state.passcode = $("#lockInput").value.trim();
  store.set("passcode", state.passcode);
  $("#lock").classList.remove("show");
  const w = unlockWaiters; unlockWaiters = [];
  w.forEach((r) => r());
});

const goTab = (t) => { state.tab = t; store.set("tab", t); render(); window.scrollTo({ top: 0 }); };
$("#tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) goTab(b.dataset.tab); });

$("#main").addEventListener("click", async (e) => {
  const run = e.target.closest("[data-item]");
  if (run) {
    const p = state.tab, w = state.week;
    const it = planFor(p, w).items.find((i) => i.id === run.dataset.item);
    if (!doneSet(p, w).has(it.id)) { if (!(await setDone(p, w, it.id, true))) return; }
    return openSheet(p, w, it);
  }
  const go = e.target.closest("[data-goto]");
  if (go) return goTab(go.dataset.goto);
  if (e.target.closest("[data-addact]")) return openAct(state.tab);
  const ac = e.target.closest("[data-accept]");
  if (ac) { ac.disabled = true; return acceptProposal(ac.dataset.accept); }
  const rb = e.target.closest("[data-rbaccept],[data-rbdismiss]");
  if (rb) { rb.disabled = true; return rebuildAction(rb.dataset.rbaccept || rb.dataset.rbdismiss, !!rb.dataset.rbaccept); }
  const ds = e.target.closest("[data-dismiss]");
  if (ds) { const s = proposalOf(ds.dataset.dismiss); if (s) store.set(dismissKey(ds.dataset.dismiss, s), "1"); return render(); }
  const rv = e.target.closest("[data-revert]");
  if (rv) return revertPlan(rv.dataset.revert, state.week);
  const gl = e.target.closest("[data-goal]");
  if (gl) return openGoal(gl.dataset.goal);
  const rf = e.target.closest("[data-refresh]");
  if (rf) { rf.disabled = true; return requestRefresh(rf.dataset.refresh); }
  const ab = e.target.closest("[data-act]");
  if (ab) return openAct(state.tab, state.hist.get(state.tab)?.activities.find((a) => String(a.id) === ab.dataset.act));
  if (e.target.closest("[data-moreacts]")) { showAllActs = showAllActs === state.tab ? null : state.tab; return render(); }
});
$("#main").addEventListener("toggle", (e) => {
  if (e.target.matches("details.notes")) store.set("notesOpen", e.target.open ? "1" : "0");
  if (e.target.matches("details.snum")) store.set("numOpen", e.target.open ? "1" : "0");
}, true);

$("#logForm").addEventListener("submit", saveSheet);
$("#logClose").addEventListener("click", closeSheet);
$("#logSheet").addEventListener("click", (e) => { if (e.target.id === "logSheet") closeSheet(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sheet.item) closeSheet(); });
$("#fKm").addEventListener("input", autoPace);
$("#fTime").addEventListener("input", autoPace);
$("#fTime").addEventListener("blur", () => { const t = normTime($("#fTime").value); if (t) $("#fTime").value = t; autoPace(); });
$("#fPace").addEventListener("input", () => { sheet.paceTouched = !!$("#fPace").value; });
$("#fPace").addEventListener("blur", () => { const t = normTime($("#fPace").value, { pace: true }); if (t) $("#fPace").value = t; });
$("#logUndo").addEventListener("click", async () => {
  const { p, w, item } = sheet;
  const l = logOf(p, w, item);
  if ((l?.km || l?.duration || l?.hr || l?.note || l?.has_photo) && !confirm(tr("Un-tick this session? Its logged details and photo will be removed."))) return;
  closeSheet();
  setDone(p, w, item, false);
});
$("#actForm").addEventListener("submit", saveAct);
$("#actClose").addEventListener("click", closeAct);
$("#goalClose").addEventListener("click", closeGoal);
$("#goalSheet").addEventListener("click", (e) => { if (e.target.id === "goalSheet") closeGoal(); });
$("#goalForm").addEventListener("submit", (e) => { e.preventDefault(); saveGoal(false); });
$("#gClear").addEventListener("click", () => saveGoal(true));
$("#aDelete").addEventListener("click", deleteAct);
$("#actSheet").addEventListener("click", (e) => { if (e.target.id === "actSheet") closeAct(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && act.open) closeAct(); });
$("#aKm").addEventListener("input", actAutoPace);
$("#aExtra").addEventListener("input", updateExtraSummary);
$("#aTime").addEventListener("input", actAutoPace);
$("#aTime").addEventListener("blur", () => { const t = normTime($("#aTime").value); if (t) $("#aTime").value = t; actAutoPace(); });
$("#aPace").addEventListener("input", () => { act.paceTouched = !!$("#aPace").value; });
$("#aShots").addEventListener("change", (e) => { if (e.target.id === "aShot" && e.target.files.length) addShots(e.target.files); e.target.value = ""; });
$("#aShots").addEventListener("click", (e) => {
  const b = e.target.closest("[data-shot]"); if (!b) return;
  const x = act.shots[Number(b.dataset.shot)]; if (!x) return;
  if (x.existing) x.removed = true; else { URL.revokeObjectURL(x.url); act.shots.splice(act.shots.indexOf(x), 1); }
  renderShots();
});

// Paste / drop a screenshot. Only acts when the clipboard actually holds an image, so pasting text into a field
// still works normally. Add-activity form open → read it; session log open → attach as its photo;
// on TJH's or SJH's tab → open Add activity and read it.
const imageFrom = (items) => [...(items || [])].find((it) => it.kind === "file" && /^image\//.test(it.type))?.getAsFile() || null;
document.addEventListener("paste", (e) => {
  const file = imageFrom(e.clipboardData?.items);
  if (!file) return;
  e.preventDefault();
  if (act.open) return addShots([file]);
  if (sheet.item) return SELF_LOG.has(sheet.p) ? openLinked([file]) : uploadPhoto(file);
  if (person(state.tab) && state.tab !== "WGW") { openAct(state.tab); addShots([file]); }
});
$("#actForm").addEventListener("dragover", (e) => { e.preventDefault(); $("#actForm").classList.add("dropping"); });
$("#actForm").addEventListener("dragleave", () => $("#actForm").classList.remove("dropping"));
$("#actForm").addEventListener("drop", (e) => {
  e.preventDefault(); $("#actForm").classList.remove("dropping");
  const files = [...(e.dataTransfer?.files || [])].filter((f) => /^image\//.test(f.type));
  if (files.length) addShots(files);
});
$("#photoBox").addEventListener("change", (e) => {
  if (e.target.id === "fPhoto" && e.target.files[0]) uploadPhoto(e.target.files[0]);
  if (e.target.id === "fShots" && e.target.files.length) openLinked([...e.target.files]);
});
$("#photoBox").addEventListener("click", async (e) => {
  const { p, w, item } = sheet;
  if (e.target.id === "fDetails") return openLinked();
  if (e.target.id === "fRemove") {
    try {
      const r = await api(`/api/photo?${qsKey(p, w, item)}`, { method: "DELETE" });
      state.logs.set(`${p}|${w}|${item}`, { ...logOf(p, w, item), has_photo: 0, updated_at: r.updated_at });
      render(); renderPhoto();
    } catch (err) { toast(tr("Couldn't remove: {e}", { e: err.message })); }
  }
  if (e.target.id === "fExtract") {
    const b = e.target;
    b.disabled = true; b.textContent = tr("Reading…");
    try {
      const r = await api("/api/extract", { method: "POST", body: JSON.stringify({ person: p, week: w, item }) });
      const got = [];
      if (r.km != null) { $("#fKm").value = r.km; got.push("distance"); }
      if (r.duration) { $("#fTime").value = r.duration; got.push("time"); }
      if (r.hr != null) { $("#fHr").value = r.hr; got.push("HR"); }
      if (r.pace) { $("#fPace").value = r.pace; sheet.paceTouched = true; got.push("pace"); } else autoPace();
      toast(got.length ? tr("Filled {f} — check & Save", { f: got.map((g) => tr(g)).join(", ") }) : tr("Couldn't find stats in that image"));
    } catch (err) { toast(err.message); }
    b.disabled = false; b.textContent = tr("✨ Fill from screenshot");
  }
});

const shiftWeek = (n) => { state.week = iso(addDays(fromIso(state.week), 7 * n)); render(); refresh(); };
$("#prev").addEventListener("click", () => shiftWeek(-1));
$("#next").addEventListener("click", () => shiftWeek(1));
$("#weekLabel").addEventListener("click", () => { state.week = thisWeek(); render(); refresh(); });

// Stay fresh: re-sync on return to foreground, roll to the new week on Monday, poll while visible.
let lastSeenWeek = thisWeek();
function onWake() {
  if (document.visibilityState !== "visible" || sheet.item || act.open) return;
  const cur = thisWeek();
  if (cur !== lastSeenWeek) { if (state.week === lastSeenWeek) state.week = cur; lastSeenWeek = cur; }
  refresh();
  loadWgw();
}
document.addEventListener("visibilitychange", onWake);
setInterval(() => document.visibilityState === "visible" && onWake(), POLL_MS);

// Settings: language + theme (stored per device by i18n.js)
function syncSeg() {
  document.querySelectorAll("#segLang button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === currentLang())));
  document.querySelectorAll("#segTheme button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === currentTheme())));
}
$("#gear").addEventListener("click", () => { syncSeg(); $("#setSheet").classList.add("show"); });
$("#setClose").addEventListener("click", () => $("#setSheet").classList.remove("show"));
$("#setSheet").addEventListener("click", (e) => { if (e.target.id === "setSheet") $("#setSheet").classList.remove("show"); });
$("#segLang").addEventListener("click", (e) => {
  const b = e.target.closest("[data-v]"); if (!b) return;
  setLang(b.dataset.v); renderExtraFields(); updateExtraSummary(); syncSeg(); render();
});
$("#segTheme").addEventListener("click", (e) => {
  const b = e.target.closest("[data-v]"); if (!b) return;
  setTheme(b.dataset.v); syncSeg();
});
applyStatic();

// Deep links: ?tab=TJH|WGW|SJH|board  &week=YYYY-MM-DD
const qs = new URLSearchParams(location.search);
if (qs.get("tab") && (qs.get("tab") === "board" || person(qs.get("tab")))) state.tab = qs.get("tab");
if (/^\d{4}-\d{2}-\d{2}$/.test(qs.get("week") || "")) state.week = iso(mondayOf(fromIso(qs.get("week"))));

render();
refresh();
loadWgw();
