// Main page: runner tabs + 📊 All, week navigation. A port of public/app.js's rendering into view models for WXML.
import { S, PEOPLE, SELF_LOG, person, planFor, doneSet, logOf, dataChanged, parseExtra } from "../../utils/state.js";
import { api, getStatic, me } from "../../utils/api.js";
import { t as tr, tKind, localized, currentLang, setLang } from "../../utils/i18n.js";
import { iso, addDays, mondayOf, fromIso, md, thisWeek, todayIso, todayIndex, toSec, DAYS, MONTHS } from "../../utils/dates.js";

const HISTORY_WEEKS = 5;
const POLL_MS = 45_000;
const WGW_COLORS = { push: "#e8a23a", pull: "#4aa3df", legs: "#b072e0", reinforce: "#7d8593", unlogged: "#3a404b", gym: "#4aa3df",
  run: "#3fb97a", swim: "#4cc0e6", bike: "#9bc25a", hike: "#c49a68", other: "#7d8593" };
const CALL_LABEL = { rest: "Rest", easy: "Easy", planned: "As planned", quality: "Quality", gym: "Gym", cross: "Cross-train" };
const CALL_COLOR = { rest: "#e5604d", easy: "#3fb97a", planned: "#4aa3df", quality: "#e8a23a", gym: "#b072e0", cross: "#4cc0e6" };
const MIN_TYPES = ["gym", "run", "swim", "bike", "hike", "other"];
const store = { get: (k) => { try { return wx.getStorageSync(k); } catch { return ""; } }, set: (k, v) => { try { wx.setStorageSync(k, v); } catch {} } };
const toast = (title) => wx.showToast({ title: String(title).slice(0, 60), icon: "none", duration: 2600 });

let page = null;
let timer = null;
let pending = false;
/** Re-render on the next tick (many async loads finish close together). */
function render() {
  if (!page || pending) return;
  pending = true;
  setTimeout(() => { pending = false; if (page) page.setData(view()); afterRender(); }, 0);
}

// ── loading ──────────────────────────────────────────────────────────────────
const historyRange = () => [iso(addDays(fromIso(S.week), -7 * (HISTORY_WEEKS - 1))), S.week];
async function load(from, to) {
  try {
    const { rows } = await api(`/api/progress?from=${from}&to=${to}`);
    for (let w = fromIso(from); iso(w) <= to; w = addDays(w, 7)) {
      for (const p of PEOPLE) {
        doneSet(p.id, iso(w)).clear();
        for (const k of [...S.logs.keys()]) if (k.startsWith(`${p.id}|${iso(w)}|`)) S.logs.delete(k);
      }
      S.loaded.add(iso(w));
    }
    for (const r of rows) { doneSet(r.person, r.week).add(r.item); S.logs.set(`${r.person}|${r.week}|${r.item}`, r); }
    S.online = true;
    S.lastSync = new Date();
  } catch { S.online = false; }
  render();
}
async function loadPlanChanges() {
  try {
    const from = iso(addDays(mondayOf(new Date()), -7 * 26)), to = iso(addDays(mondayOf(new Date()), 7));
    S.planChanges = (await api(`/api/plan?from=${from}&to=${to}`)).changes || {};
    render();
  } catch {}
}
async function loadGoals() {
  try { S.goals = (await api("/api/goal")).goals || {}; render(); } catch {}
}
let wgwLoadedAt = 0;
async function loadWgw() {
  if (Date.now() - wgwLoadedAt < 10 * 60_000) return;
  try { S.wgw = await getStatic(`/wgw.json?d=${todayIso()}`); wgwLoadedAt = Date.now(); render(); } catch {}
}
const refresh = () => Promise.all([loadGoals(), loadPlanChanges(), load(...historyRange()), loadWgw()]);

async function loadHist(p) {
  const h = S.hist.get(p);
  if (h && (h.loading || Date.now() - h.at < 5 * 60_000)) return;
  const prev = h || { activities: [], logs: [] };
  S.hist.set(p, { ...prev, loading: true, at: prev.at || 0 });
  try {
    const from = iso(addDays(mondayOf(new Date()), -7 * 25)), to = todayIso();
    const d = await api(`/api/activities?person=${p}&from=${from}&to=${to}`);
    S.hist.set(p, { activities: d.activities, logs: d.logs, at: Date.now(), ready: true });
  } catch (e) {
    S.hist.set(p, { ...prev, at: Date.now(), ready: true, error: e.message });
  }
  render();
}
async function loadToday(p) {
  const today = todayIso();
  const cur = S.today.get(p) || {};
  S.today.set(p, { ...cur, loading: true, dirty: false });
  try {
    const d = await api("/api/today", { method: "POST", data: { person: p, today } });
    S.today.set(p, { suggestion: d.suggestion, newer: d.newer, refresh: d.refresh, date: today, at: Date.now() });
    if (d.refresh?.pending) pollToday(p);
  } catch (e) {
    S.today.set(p, { ...cur, loading: false, error: e.message, date: today, at: Date.now() });
  }
  render();
}
const polls = new Map();
function pollToday(p) {
  if (polls.has(p)) return;
  polls.set(p, setTimeout(() => { polls.delete(p); loadToday(p); }, 20_000));
}
const todayStale = (t) => !t || (!t.loading && (t.dirty || t.date !== todayIso() || Date.now() - t.at > 30 * 60_000));

/** Loads the current view needs (the site starts these from its render functions). */
function afterRender() {
  const cur = S.week === thisWeek();
  const self = S.tab === "board" ? [...SELF_LOG] : SELF_LOG.has(S.tab) ? [S.tab] : [];
  for (const p of self) {
    loadHist(p);
    if (cur && todayStale(S.today.get(p))) loadToday(p);
  }
}

// ── view models ──────────────────────────────────────────────────────────────
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

function header() {
  const mon = fromIso(S.week), cur = thisWeek();
  const rel = tr(S.week === cur ? "This week" : S.week === iso(addDays(fromIso(cur), -7)) ? "Last week"
    : S.week === iso(addDays(fromIso(cur), 7)) ? "Next week" : "Tap for this week");
  const tabs = [...PEOPLE.map((p) => ({ id: p.id, label: p.id, color: p.color })), { id: "board", label: tr("📊 All"), color: "" }]
    .map((x) => ({ ...x, on: S.tab === x.id }));
  return { weekRange: `${md(mon)} – ${md(addDays(mon, 6))}`, weekRel: rel, tabs, lang: currentLang() === "zh" ? "EN" : "中文" };
}

function goalVM(pid) {
  const g = S.goals[pid]?.text ? S.goals[pid] : null;
  if (!g) return { add: true, label: tr("+ Set a target") };
  let date = "", left = "";
  if (g.date) {
    const [, m, d] = g.date.split("-").map(Number);
    const days = Math.round((fromIso(g.date) - fromIso(todayIso())) / 864e5);
    date = `${m}.${d}`;
    left = days > 0 ? tr("{n} days to go", { n: days }) : days === 0 ? tr("Today!") : tr("done");
  }
  return { add: false, text: `🎯 ${currentLang() === "zh" && g.zh ? g.zh : g.text}`, date, left };
}

const proposalOf = (p) => (p === "WGW" ? S.wgw?.suggestion : S.today.get(p)?.suggestion);
const dismissKey = (p, s) => `planDismiss:${p}:${s.date}`;
function proposalVM(p, s) {
  const pc = s?.plan_change;
  if (!pc?.sessions || s.date !== todayIso() || pc.week < thisWeek()) return null;
  const cur = S.planChanges[`${p}|${pc.week}`];
  if (cur?.source_date === s.date) return { ok: true };
  if (store.get(dismissKey(p, s))) return null;
  return {
    head: tr("Proposed plan change · {w}", { w: pc.week === thisWeek() ? tr("this week") : tr("next week") }),
    why: (currentLang() === "zh" && s.zh?.plan_why) || pc.why,
    sessions: pc.sessions.map((x, i) => ({ k: i, day: tr(x.day), text: `${tKind(x.kind)} · ${x.title}`, meta: x.meta || "" })),
  };
}

function refreshVM(p, t) {
  const r = t?.refresh;
  if (!r) return null;
  if (r.pending) return { pending: true };
  const err = t.refreshError || (r.failed ? tr("The last refresh didn't go through (it wasn't counted). Try again later.") : "");
  if (!t.newer && t.suggestion) return err ? { err } : null;
  if (!r.left) return { err, used: tr("All {n} refreshes for today are used.", { n: r.used }) };
  return { err, button: tr("↻ Refresh suggestion"), left: tr("{n} left today", { n: r.left }) };
}

function cardVM(s, color, mute) {
  if (!s) return { color, mute, head: tr("Today") };
  s = localized(s);
  return {
    color: CALL_COLOR[s.call] || color, head: tr("Today"),
    by: s.by === "claude" ? tr("by Claude · {t}", { t: s.at || "9:00" }) : "",
    call: tr(CALL_LABEL[s.call] || s.call), yesterday: s.yesterday || "", headline: s.headline, session: s.session || "",
    why: s.why || "", form: s.form || "", science: s.science || "", prehab: s.prehab || [], numbers: s.numbers || [],
    next: s.next ? `${tr("Next:")} ${s.next}` : "",
  };
}
function todayCard(p, color) {
  const t = S.today.get(p);
  if (t?.suggestion && t.suggestion.date === todayIso()) {
    const c = cardVM(t.suggestion, color);
    c.proposal = proposalVM(p, t.suggestion);
    c.note = t.newer && !t.refresh?.pending
      ? tr(t.refresh?.left ? "Sessions or target changed since this was written." : "New sessions logged since this was written. They're in tomorrow's 9:00 suggestion.") : "";
    c.refresh = refreshVM(p, t);
    return c;
  }
  const msg = !t || t.loading ? tr("Loading today's suggestion…")
    : t.error ? tr("Couldn't load the suggestion: {e}", { e: t.error })
    : tr("Claude writes this every morning at 9:00 from the sessions logged here. Nothing for today yet.");
  const c = cardVM(null, color, msg);
  c.refresh = t && !t.loading && !t.error ? refreshVM(p, t) : null;
  return c;
}
function wgwCard(color) {
  const s = localized(S.wgw?.suggestion);
  if (!s || s.date !== todayIso()) {
    return cardVM(null, color, tr(S.wgw ? "No suggestion yet today. It's written at 9:00 after the Garmin sync." : "Loading today's suggestion…"));
  }
  const c = cardVM(S.wgw.suggestion, color);
  c.next = s.next ? `${tr("Tomorrow:")} ${s.next}` : "";
  c.proposal = proposalVM("WGW", S.wgw.suggestion);
  return c;
}

/** Calendar (26 weeks) + minutes per week. g = { dataThrough, calendar: {date: {gym, cardio[]}}, weekly: [...] } */
function dashVM(g, { splits = false, note = "" } = {}) {
  const end = fromIso(g.dataThrough);
  const cols = [];
  let lastMonth = -1;
  for (let w = addDays(mondayOf(end), -7 * 25), n = 0; w <= end; w = addDays(w, 7), n++) {
    const col = { id: `c${n}`, month: w.getMonth() !== lastMonth ? tr(MONTHS[w.getMonth()]) : "", cells: [] };
    lastMonth = w.getMonth();
    for (let i = 0; i < 7; i++) {
      const d = addDays(w, i), e = g.calendar[iso(d)];
      col.cells.push(d > end ? { k: i, hidden: true }
        : { k: i, bg: e?.gym ? WGW_COLORS[e.gym] : "", dot: e?.cardio?.length ? WGW_COLORS[e.cardio[0]] : "", solo: !e?.gym });
    }
    cols.push(col);
  }
  const weeks = g.weekly.slice(-12), types = ["gym", "run", "swim", "bike", "hike", "other"];
  const max = Math.max(60, ...weeks.map((w) => types.reduce((a, t) => a + (w[t] || 0), 0)));
  const bars = weeks.map((w) => ({
    k: w.week, label: md(fromIso(w.week)),
    segs: types.filter((t) => w[t]).map((t) => ({ t, h: (w[t] / max) * 100, c: t === "gym" ? WGW_COLORS.pull : WGW_COLORS[t] })),
  }));
  const key = (list, dot) => list.map((t) => ({ t, c: WGW_COLORS[t], label: tr(t), dot }));
  const cardio = ["run", "swim", "bike", "hike"].concat(splits ? [] : ["other"]);
  return {
    cols, last: cols.length ? cols[cols.length - 1].id : "", bars, note,
    calKey: [...key(splits ? ["push", "pull", "legs", "reinforce"] : ["gym"], false), ...key(cardio, true)],
    barKey: [{ t: "gym", c: WGW_COLORS.pull, label: "gym" }, ...key(cardio, false)],
  };
}

const durMin = (d) => (d ? Math.round(toSec(d) / 60) : 0);
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

function selfDash(p) {
  const h = S.hist.get(p);
  if (!h?.ready) return null;
  const entries = h.activities.map((a) => ({ date: a.date, type: a.type, min: durMin(a.duration), km: a.type === "run" ? +a.km || 0 : 0 }));
  const have = new Set(entries.map((e) => `${e.date}|${e.type}`));
  for (const r of h.logs) {
    const it = planFor(p, r.week).items?.find((i) => i.id === r.item);
    if (!it) continue;
    const date = iso(addDays(fromIso(r.week), it.dayIndex));
    const type = /strength/i.test(it.kind) ? "gym" : "run";
    if (have.has(`${date}|${type}`)) continue;
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
  return { dataThrough: todayIso(), calendar, weekly: weeks };
}

let showAllActs = null;
function selfLogVM(p) {
  const h = S.hist.get(p);
  const acts = h?.activities || [];
  const shown = showAllActs === p ? acts : acts.slice(0, 5);
  const g = selfDash(p);
  return {
    acts: shown.map((a) => ({ id: a.id, c: WGW_COLORS[a.type] || WGW_COLORS.other, title: a.title || tr(a.type),
      line: actDate(a.date) + (actLine(a) ? ` · ${actLine(a)}` : "") })),
    empty: tr(h?.ready ? "Nothing added yet. Add runs, gym or swims here — on or off the plan, past sessions too." : "Loading…"),
    more: acts.length > 5 ? (showAllActs === p ? tr("Show fewer") : tr("Show all {n}", { n: acts.length })) : "",
    dash: g ? dashVM(g, { note: tr("From what's logged here: ticked plan sessions plus added activities.") }) : null,
  };
}

function personVM(pid) {
  const p = person(pid);
  const s = summary(pid, S.week);
  const isCur = S.week === thisWeek();
  const vm = { id: pid, color: p.color, goal: goalVM(pid), wgw: pid === "WGW" };
  if (!s) {
    vm.empty = tr(planFor(pid, S.week).empty);
    vm.blurb = p.blurb;
  } else {
    const { plan, done, total, pct, km } = s;
    const set = doneSet(pid, S.week);
    const mon = fromIso(S.week);
    Object.assign(vm, {
      title: plan.title, sub: `${pid} · ${plan.sub}`, adjusted: plan.adjusted ?? null, done, total,
      pct: pct * 100, fill: pct === 1 ? "var(--ok)" : p.color,
      km: km ? tr("{n} km logged", { n: Math.round(km * 10) / 10 }) : "",
    });
    const byDay = new Map();
    for (const it of plan.items) { if (!byDay.has(it.dayIndex)) byDay.set(it.dayIndex, []); byDay.get(it.dayIndex).push(it); }
    vm.days = [...byDay].sort((a, b) => a[0] - b[0]).map(([di, items]) => {
      const today = isCur && di === todayIndex();
      return {
        di, num: addDays(mon, di).getDate(), label: today ? tr("Today") : tr(DAYS[di]), today,
        items: items.map((it) => {
          if (it.rest) return { id: it.id, rest: true, title: it.title };
          const d = set.has(it.id);
          const logged = d ? loggedLine(logOf(pid, S.week, it.id)) : "";
          return { id: it.id, title: it.title, kind: tKind(it.kind), color: it.color, meta: it.meta, done: d,
            missed: itemStatus(S.week, it, d) === "miss", logged: d ? logged || tr("+ add details") : "" };
        }),
      };
    });
    if (plan.notes) {
      const n = plan.notes;
      vm.notes = { title: tr(n.title), open: store.get("notesOpen") === "1",
        rows: n.rows.map(([tg, c, nm, v, sm]) => ({ tg, c, nm: tKind(nm), v, sm })), text: n.text };
    }
  }
  if (isCur) vm.card = pid === "WGW" ? wgwCard(p.color) : todayCard(pid, p.color);
  if (vm.card) vm.card.numOpen = store.get("numOpen") !== "0";
  if (pid === "WGW") vm.dash = S.wgw ? dashVM(S.wgw, { splits: true, note: tr("From Garmin, updated {t}.", { t: S.wgw.generated }) }) : null;
  else vm.log = selfLogVM(pid);
  return vm;
}

function weekTotals(pid, wk) {
  if (pid === "WGW") {
    const w = S.wgw?.weekly.find((x) => x.week === wk);
    return w ? { min: MIN_TYPES.reduce((a, t) => a + (w[t] || 0), 0), w } : S.wgw ? { min: 0, w: {} } : null;
  }
  const g = selfDash(pid);
  if (!g) return null;
  const w = g.weekly.find((x) => x.week === wk) || {};
  return { min: MIN_TYPES.reduce((a, t) => a + (w[t] || 0), 0), km: w.km || 0, n: w.n || 0, w };
}
function todayOf(pid) {
  if (pid === "WGW") { const s = S.wgw?.suggestion; return s?.date === todayIso() ? s : null; }
  const t = S.today.get(pid);
  return t?.suggestion?.date === todayIso() ? t.suggestion : null;
}

function boardVM() {
  const w = S.week, isCur = w === thisWeek();
  const cards = PEOPLE.map((p) => {
    const s = summary(p.id, w);
    const tot = weekTotals(p.id, w);
    const sug = isCur ? todayOf(p.id) : null;
    const c = { id: p.id, color: p.color, count: s ? `${s.done}` : "—", total: s ? `/${s.total}` : "", blurb: s ? s.plan.title : p.blurb };
    if (s) {
      const set = doneSet(p.id, w);
      Object.assign(c, { pct: s.pct * 100, fill: s.pct === 1 ? "var(--ok)" : p.color,
        pips: s.items.map((it) => ({ id: it.id, st: itemStatus(w, it, set.has(it.id)), label: tr(it.day) })) });
    } else c.emptyText = tr(planFor(p.id, w).empty);
    if (tot && tot.min) {
      c.mins = `${tot.min}′`;
      c.kmRun = tot.km ? tr("{n} km run", { n: Math.round(tot.km * 10) / 10 }) : "";
      c.parts = MIN_TYPES.filter((t) => tot.w[t]).map((t) => ({ t, c: t === "gym" ? WGW_COLORS.pull : WGW_COLORS[t], label: `${tr(t)} ${tot.w[t]}′` }));
    }
    if (sug) { const ls = localized(sug); c.today = { color: CALL_COLOR[ls.call] || p.color, call: tr(CALL_LABEL[ls.call] || ls.call), headline: ls.headline }; }
    return c;
  });
  const weeks = [];
  for (let i = HISTORY_WEEKS - 1; i >= 0; i--) weeks.push(iso(addDays(fromIso(w), -7 * i)));
  const rows = PEOPLE.map((p) => ({
    id: p.id,
    cells: weeks.map((wk) => {
      const s = summary(p.id, wk);
      const tot = weekTotals(p.id, wk);
      const mins = tot && tot.min ? `${tot.min}′` : "";
      if (!s || !S.loaded.has(wk)) return { wk, text: "—", mins, bg: "var(--card)", fg: "var(--mute)" };
      const alpha = Math.round((0.15 + 0.85 * s.pct) * 255).toString(16).padStart(2, "0");
      return { wk, text: `${Math.round(s.pct * 100)}%`, mins, bg: s.pct === 0 ? "var(--card)" : p.color + alpha, fg: s.pct >= 0.6 ? "#0f1115" : "var(--text)" };
    }),
  }));
  return {
    title: isCur ? tr("This week") : tr("Week of {d}", { d: md(fromIso(w)) }), cards,
    histTitle: tr("Last {n} weeks", { n: HISTORY_WEEKS }), weeks: weeks.map((wk) => ({ wk, label: md(fromIso(wk)) })), rows,
    legend: tr("Top: share of planned sessions ticked off. Below: training minutes that week (WGW from Garmin; TJH and SJH from what they log). Tap a runner to open their week."),
  };
}

const L = () => ({
  section: { training: tr("Training calendar"), minutes: tr("Minutes per week"), log: tr("My log") },
  addAct: tr("+ Add activity"), adjusted: tr("Adjusted"), revert: tr("Revert"), missed: tr("Missed"),
  yesterday: tr("Yesterday"), form: tr("Form"), science: tr("Why it works"), prehab: tr("Prehab · 2×/week, ~15 min"),
  prehabNote: tr("From recurring form issues in the logged runs. After easy runs or on rest days; stop if anything hurts."),
  numbers: tr("Numbers"),
  numbersNote: tr("VDOT and paces: Jack Daniels' formula. Easy ceiling: 79% of max HR, or 74% of HR reserve when a resting HR is set."),
  accepted: tr("Plan change accepted ✓"), notListed: tr("Days not listed become rest. Earlier days stay as they are."),
  dismiss: tr("Dismiss"), accept: tr("Accept"), rewriting: tr("Rewriting… usually 1–3 min."),
});

function view() {
  const status = !S.online ? tr("Offline — changes may not be saved")
    : S.lastSync ? tr("Synced {t}", { t: `${String(S.lastSync.getHours()).padStart(2, "0")}:${String(S.lastSync.getMinutes()).padStart(2, "0")}` }) : tr("Loading…");
  return { h: header(), L: L(), board: S.tab === "board" ? boardVM() : null, p: S.tab === "board" ? null : personVM(S.tab), status };
}

// ── actions ──────────────────────────────────────────────────────────────────
async function setDone(p, w, item, done) {
  const set = doneSet(p, w);
  done ? set.add(item) : set.delete(item);
  if (done) wx.vibrateShort({ type: "light" });
  render();
  try {
    const r = await api("/api/progress", { method: "POST", data: { person: p, week: w, item, done } });
    if (r.row) S.logs.set(`${p}|${w}|${item}`, r.row);
    S.online = true;
    dataChanged(p);
    return true;
  } catch {
    done ? set.delete(item) : set.add(item);
    S.online = false;
    toast(tr("Couldn't save — check your connection"));
    render();
    return false;
  }
}

Page({
  data: {},
  onLoad(q) {
    page = this;
    const valid = (t) => t === "board" || !!person(t);
    S.tab = valid(q.tab) ? q.tab : valid(store.get("tab")) ? store.get("tab") : valid(me()) ? me() : PEOPLE[0].id;
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.week || "")) S.week = iso(mondayOf(fromIso(q.week)));
    this.lastSeenWeek = thisWeek();
    this.setData(view());
  },
  onShow() {
    page = this;
    const cur = thisWeek(); // roll to the new week on Monday
    if (cur !== this.lastSeenWeek) { if (S.week === this.lastSeenWeek) S.week = cur; this.lastSeenWeek = cur; }
    wx.setNavigationBarTitle({ title: "Run Club" });
    render();
    refresh();
    clearInterval(timer);
    timer = setInterval(refresh, POLL_MS);
  },
  onHide() { clearInterval(timer); },
  onUnload() { clearInterval(timer); page = null; },
  async onPullDownRefresh() {
    wgwLoadedAt = 0;
    for (const h of S.hist.values()) h.at = 0;
    for (const t of S.today.values()) t.dirty = true;
    await refresh();
    wx.stopPullDownRefresh();
  },
  onShareAppMessage() { return { title: "Run Club", path: "/pages/index/index" }; },

  goTab(e) { S.tab = e.currentTarget.dataset.tab; store.set("tab", S.tab); render(); wx.pageScrollTo({ scrollTop: 0, duration: 0 }); },
  prevWeek() { S.week = iso(addDays(fromIso(S.week), -7)); render(); refresh(); },
  nextWeek() { S.week = iso(addDays(fromIso(S.week), 7)); render(); refresh(); },
  thisWeek() { S.week = thisWeek(); render(); refresh(); },
  toggleLang() { setLang(currentLang() === "zh" ? "en" : "zh"); render(); },

  async tapItem(e) {
    const p = S.tab, w = S.week, item = e.currentTarget.dataset.item;
    if (!doneSet(p, w).has(item) && !(await setDone(p, w, item, true))) return;
    wx.navigateTo({ url: `/pages/log/log?p=${p}&w=${w}&item=${item}` });
  },
  openGoal(e) { wx.navigateTo({ url: `/pages/goal/goal?p=${e.currentTarget.dataset.p}` }); },
  addAct() { wx.navigateTo({ url: `/pages/act/act?p=${S.tab}` }); },
  openAct(e) { wx.navigateTo({ url: `/pages/act/act?p=${S.tab}&id=${e.currentTarget.dataset.id}` }); },
  moreActs() { showAllActs = showAllActs === S.tab ? null : S.tab; render(); },
  goto(e) { S.tab = e.currentTarget.dataset.p; store.set("tab", S.tab); render(); wx.pageScrollTo({ scrollTop: 0, duration: 0 }); },
  toggleNotes() { store.set("notesOpen", store.get("notesOpen") === "1" ? "0" : "1"); render(); },
  toggleNumbers() { store.set("numOpen", store.get("numOpen") === "0" ? "1" : "0"); render(); },

  async accept(e) {
    const p = e.currentTarget.dataset.p;
    const s = proposalOf(p), pc = s?.plan_change; if (!pc) return;
    try {
      const r = await api("/api/plan", { method: "POST", data: { person: p, today: todayIso(), week: pc.week, change: pc, source: s.date } });
      S.planChanges[`${p}|${pc.week}`] = r.change;
      toast(tr("Plan updated ✓"));
    } catch (err) { toast(err.message); }
    render();
  },
  dismiss(e) {
    const p = e.currentTarget.dataset.p, s = proposalOf(p);
    if (s) store.set(dismissKey(p, s), "1");
    render();
  },
  revert(e) {
    const p = e.currentTarget.dataset.p, week = S.week;
    wx.showModal({ content: tr("Go back to the original plan for this week?"), success: async ({ confirm }) => {
      if (!confirm) return;
      try {
        await api("/api/plan", { method: "POST", data: { person: p, week, revert: true } });
        delete S.planChanges[`${p}|${week}`];
      } catch (err) { toast(err.message); }
      render();
    } });
  },
  async requestRefresh(e) {
    const p = e.currentTarget.dataset.p;
    const t = S.today.get(p) || {};
    try {
      const r = await api("/api/refresh", { method: "POST", data: { person: p, today: todayIso() } });
      S.today.set(p, { ...t, refresh: r, refreshError: null });
      if (r.pending) pollToday(p);
    } catch (err) {
      S.today.set(p, { ...t, refreshError: err.message });
    }
    render();
  },
});
