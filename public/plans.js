// ─── Plan data ──────────────────────────────────────────────────────────────
// Weeks are keyed by their Monday (YYYY-MM-DD). Each session is
//   [day, color, kind, title, meta?]
// Session ids are derived from the day ("tue", "wed2" for a 2nd session on Wed),
// so keep a day's order stable once people start ticking things off.

const C = {
  easy: "#3fb97a", marathon: "#4aa3df", threshold: "#e8a23a", interval: "#e5604d",
  rep: "#b072e0", goal: "#f2d14b", easy3: "#e8c23a", long: "#e5704d", blue: "#4aa3df",
};

export const PEOPLE = [
  { id: "TJH", color: "#e8a23a", blurb: "Sub-24 5K · 8 weeks" },
  { id: "WGW", color: "#3fb97a", blurb: "3 runs a week" },
  { id: "SJH", color: "#4aa3df", blurb: "Weekly training plan" },
];

// ── TJH · 8-Week Sub-24 5K ──────────────────────────────────────────────────
const TJH_START = "2026-11-16"; // Monday of Week 1 — change if TJH started on a different week
const TJH_WEEKS = [
  { tag: "Test", km: 28, s: [
    ["Tue", C.goal, "Test", "5K time trial, all-out"],
    ["Thu", C.easy, "Easy", "E 6 km + 6 strides"],
    ["Sat", C.easy, "Easy", "E 6 km"],
    ["Sun", C.easy, "Long", "Long 8 km easy"] ] },
  { km: 33, s: [
    ["Tue", C.interval, "Interval", "6×800 m @ I", "2 min jog"],
    ["Thu", C.threshold, "Threshold", "3×1.6 km @ T", "90 s jog"],
    ["Sat", C.easy, "Easy", "E 6 km + strides"],
    ["Sun", C.easy, "Long", "Long 9 km easy"] ] },
  { km: 36, s: [
    ["Tue", C.interval, "Interval", "5×1 km @ I", "2:30 jog"],
    ["Thu", C.threshold, "Threshold", "25 min continuous @ T"],
    ["Sat", C.easy, "Easy", "E 7 km"],
    ["Sun", C.marathon, "Long", "Long 10 km, last 2 km @ M"] ] },
  { tag: "Lighter · Test", km: 27, s: [
    ["Tue", C.rep, "Repetition", "8×400 m @ R", "400 m jog"],
    ["Thu", C.easy, "Easy", "E 6 km + strides"],
    ["Sat", C.easy, "Easy", "E 5 km"],
    ["Sun", C.goal, "Test", "5K time trial", "Reset paces afterwards"] ] },
  { km: 38, s: [
    ["Tue", C.interval, "Interval", "4×1.2 km @ I", "2:30 jog"],
    ["Thu", C.threshold, "Threshold", "2×15 min @ T", "2 min jog"],
    ["Sat", C.easy, "Easy", "E 7 km + strides"],
    ["Sun", C.easy, "Long", "Long 11 km easy"] ] },
  { tag: "Peak", km: 40, s: [
    ["Tue", C.interval, "Interval", "6×1 km @ I", "2 min jog"],
    ["Thu", C.threshold, "Threshold", "30 min continuous @ T"],
    ["Sat", C.easy, "Easy", "E 7 km"],
    ["Sun", C.marathon, "Long", "Long 12 km, last 3 km @ M"] ] },
  { km: 35, s: [
    ["Tue", C.goal, "Goal pace", "3×1.6 km @ G + 4×200 m @ R", "3 min jog"],
    ["Thu", C.threshold, "Threshold", "20 min @ T"],
    ["Sat", C.easy, "Easy", "E 6 km + strides"],
    ["Sun", C.easy, "Long", "Long 10 km easy"] ] },
  { tag: "Taper · Race", km: 20, s: [
    ["Tue", C.goal, "Goal pace", "4×800 m @ G", "2 min jog"],
    ["Thu", C.easy, "Easy", "E 5 km + 4 strides"],
    ["Sat", C.easy, "Easy", "Rest or E 3 km"],
    ["Sun", C.goal, "Race", "5K race", "Target < 24:00"] ] },
];
const TJH_NOTES = {
  title: "Paces",
  rows: [
    ["E", C.easy, "Easy", "6:15–6:50", "HR 135–150"],
    ["M", C.marathon, "Marathon", "~5:35", "HR 155–165"],
    ["T", C.threshold, "Threshold", "~5:13", "HR 165–175"],
    ["I", C.interval, "Interval", "~4:50", "/km"],
    ["R", C.rep, "Repetition", "~4:33", "400 m ≈ 1:49"],
    ["G", C.goal, "Goal 5K", "4:48", "/km"],
  ],
  text: [
    "Hard sessions: + ~2 km warm-up & 1 km cool-down jog.",
    "Hit pace, don't beat it. Back off if easy HR stays >155 for a week or anything aches >2 days.",
    "Strength 2×15 min/week. Strides = 20 s quick & relaxed.",
  ],
};

// Targets used to judge logged runs (pace "m:ss" per km, null = open-ended).
const TJH_TARGETS = {
  Easy: { pace: ["6:15", "6:50"], hr: [135, 150] },
  Long: { pace: ["6:15", "6:50"], hr: [135, 150] },
  Threshold: { pace: ["5:08", "5:18"], hr: [165, 175] },
  Interval: { pace: ["4:45", "4:55"] },
  Repetition: { pace: ["4:28", "4:38"] },
  "Goal pace": { pace: ["4:43", "4:53"] },
};
const tjhTarget = (it) => (/@ ?[MGR]/.test(it.title) && it.kind === "Long" ? null : TJH_TARGETS[it.kind] || null);

// ── WGW · My Running Week (same every week) ─────────────────────────────────
const WGW_WEEK = [
  ["Wed", C.easy, "Easy", "Easy run", "pace ≤ 6:00 · HR ≤ 150", { hr: [null, 150] }],
  ["Sat", C.threshold, "Tempo", "Tempo run", "pace 5:00 · HR 170+", { pace: ["4:55", "5:05"], hr: [170, null] }],
  ["Sun", C.blue, "Long · Easy", "Long easy run", "30–40 min · HR strictly ≤ 140", { hr: [null, 140] }],
];

// ── SJH · Training Plan (add a new block each week) ─────────────────────────
const SJH_WEEKS = {
  "2026-11-16": { label: "Week 3", km: 39.5, s: [
    ["Mon", null, "Rest", "Rest"],
    ["Tue", C.easy, "Easy · L2", "5.5 km easy run", "36 min · 296 kcal"],
    ["Wed", C.easy3, "Easy · L3", "8 km easy run", "52 min · 430 kcal"],
    ["Wed", C.blue, "Strength · L1", "Lower-body strength 2", "14 min · 跑者下肢力量训练2级"],
    ["Thu", C.threshold, "Tempo · L2", "5.5 km progressive tempo", "33 min · 296 kcal"],
    ["Fri", C.blue, "Strength · L1", "Core strength 2", "17 min · 跑者核心力量训练2级"],
    ["Sat", C.long, "Long · L4", "15 km steady long run", "97 min · 807 kcal"],
    ["Sun", C.easy, "Easy · L2", "5.5 km easy run", "36 min · 296 kcal"] ] },
};

// ─── Lookup ─────────────────────────────────────────────────────────────────
const DAY_INDEX = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

function toItems(rows, targetFor = () => null) {
  const seen = {};
  return rows.map(([day, color, kind, title, meta, target]) => {
    const base = day.toLowerCase();
    seen[base] = (seen[base] || 0) + 1;
    return {
      id: seen[base] === 1 ? base : base + seen[base],
      day, dayIndex: DAY_INDEX[day], color, kind, title, meta: meta || "",
      rest: kind === "Rest",
      target: target || targetFor({ kind, title }) || null,
    };
  });
}

const weeksBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / (7 * 864e5));

function basePlan(person, week) {
  if (person === "TJH") {
    const n = weeksBetween(TJH_START, week);
    if (n < 0) return { empty: `The 8-week plan starts the week of ${TJH_START}.` };
    if (n >= TJH_WEEKS.length) return { empty: "8-week plan finished 🎉 Time for a new goal." };
    const w = TJH_WEEKS[n];
    return {
      title: `Week ${n + 1} of 8` + (w.tag ? ` · ${w.tag}` : ""),
      sub: `~${w.km} km · Tue · Thu · Sat · Sun`,
      rows: w.s, targetFor: tjhTarget, notes: TJH_NOTES,
    };
  }
  if (person === "WGW") return { title: "My Running Week", sub: "3 runs · pace min/km · HR bpm", rows: WGW_WEEK };
  if (person === "SJH") {
    const w = SJH_WEEKS[week];
    if (!w) return { empty: "No plan entered for this week yet — add it to SJH_WEEKS in plans.js." };
    return { title: w.label, sub: `${w.km} km running`, rows: w.s };
  }
  return { empty: "Unknown runner." };
}

/**
 * The week's plan, with an accepted change applied (TJH/WGW: Claude proposes, the runner accepts; see
 * functions/api/plan.js). changes: { "TJH|2026-11-16": { from, sessions, why } } — days from `from` on are replaced.
 * @returns {{title, sub, items, notes?, adjusted?} | {empty: string}}
 */
export function planFor(person, week, changes) {
  const b = basePlan(person, week);
  const ch = CHANGEABLE.has(person) ? changes?.[`${person}|${week}`] : null;
  if (!ch) return b.empty ? b : { title: b.title, sub: b.sub, items: toItems(b.rows, b.targetFor), notes: b.notes };
  const days = changeDays(ch); // { dayIndex: [sessions] }: those days are replaced; [] = rest
  const base = b.rows || [];
  const rows = [...base.filter((r) => !(DAY_INDEX[r[0]] in days)),
    ...Object.entries(days).flatMap(([i, list]) => {
      const day = DAY_NAMES[i];
      // An emptied day shows "Rest" only where the plan had something, so a pause is visible.
      if (!list.length) return base.some((r) => r[0] === day && r[2] !== "Rest") ? [[day, null, "Rest", "Rest"]] : [];
      return list.map((x) => [day, KIND_COLOR[x.kind], x.kind, x.title, x.meta || ""]);
    })]
    .sort((x, y) => DAY_INDEX[x[0]] - DAY_INDEX[y[0]]); // stable: keeps a day's order
  return { title: b.title || "Adjusted week", sub: b.empty ? "" : b.sub, items: toItems(rows, b.targetFor),
    notes: b.notes, adjusted: ch.why || "" };
}

// ─── Plan changes (proposed by Claude in the daily suggestion, accepted by the runner) ──────────────────
export const CHANGEABLE = new Set(["TJH", "WGW"]);
const KIND_COLOR = {
  Easy: C.easy, Long: C.easy, "Long · Easy": C.blue, Tempo: C.threshold, Threshold: C.threshold,
  Interval: C.interval, Repetition: C.rep, "Goal pace": C.goal, Test: C.goal, Race: C.goal,
  Strength: C.blue, Cross: C.blue, Rest: null,
};
export const CHANGE_KINDS = Object.keys(KIND_COLOR);
// Plan text feeds every later prompt, so it is English workout notation only (no quotes, brackets or angle brackets).
const PLAN_TEXT = /^[A-Za-z0-9 .,:;'’()+\-–—/&!?@×·%~≤≥=]*$/;
const txt = (v, max, what) => {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  if (t.length > max || !PLAN_TEXT.test(t)) throw new Error(`plan change: bad ${what}`);
  return t;
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dShift = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const dIdx = (d) => (new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7;
const dMon = (d) => dShift(d, -dIdx(d));

/** A stored week change → { dayIndex: [sessions] }. Older ones ({from, sessions by day}) replaced from..Sun. */
export function changeDays(ch) {
  if (ch?.days) return ch.days;
  const out = {};
  for (let i = ch?.from || 0; i < 7; i++) out[i] = [];
  for (const x of ch?.sessions || []) (out[DAY_INDEX[x.day]] ||= []).push(x);
  return out;
}

/** Any proposal (a date range, or the older {week, from, sessions by day}) → {start, end, why, sessions with date+day}. */
export function normChange(pc) {
  if (!pc || !Array.isArray(pc.sessions)) return null;
  if (pc.start && pc.end) {
    if (!pc.sessions.every((x) => DATE_RE.test(x?.date || ""))) return null;
    return { ...pc, sessions: pc.sessions.map((x) => ({ ...x, day: DAY_NAMES[dIdx(x.date)] })) };
  }
  if (!DATE_RE.test(pc.week || "")) return null;
  return { start: dShift(pc.week, pc.from || 0), end: dShift(pc.week, 6), why: pc.why,
    sessions: pc.sessions.filter((x) => x.day in DAY_INDEX).map((x) => ({ ...x, date: dShift(pc.week, DAY_INDEX[x.day]) })) };
}

function cleanSession(x) {
  if (!(x?.kind in KIND_COLOR)) throw new Error("plan change: bad kind");
  const title = txt(x.kind === "Rest" ? x.title || "Rest" : x.title, 50, "title");
  if (!title) throw new Error("plan change: no title");
  return { kind: x.kind, title, meta: txt(x.meta, 40, "note") };
}

/**
 * Validates a proposal over a date range (≤ 14 days, from today on; days already past are left as they were) and
 * splits it per week → [{ week, days: { dayIndex: [sessions] }, why }]. Days in the range with nothing listed are rest.
 * Throws with a reason.
 */
export function splitChange(pc, today) {
  const c = normChange(pc);
  if (!c || !DATE_RE.test(c.start) || !DATE_RE.test(c.end) || c.end < c.start) throw new Error("plan change: bad dates");
  if (c.end < today) throw new Error("plan change: its days have passed");
  if (c.end > dShift(today, 13)) throw new Error("plan change: more than 2 weeks ahead");
  if (c.sessions.length > 20) throw new Error("plan change: too many sessions");
  const start = c.start < today ? today : c.start;
  const why = txt(c.why, 200, "reason");
  const weeks = new Map();
  for (let d = start; d <= c.end; d = dShift(d, 1)) {
    if (!weeks.has(dMon(d))) weeks.set(dMon(d), {});
    weeks.get(dMon(d))[dIdx(d)] = [];
  }
  for (const x of c.sessions) {
    if (x.date < start) continue; // already past
    if (x.date > c.end) throw new Error("plan change: a session is outside its dates");
    weeks.get(dMon(x.date))[dIdx(x.date)].push(cleanSession(x));
  }
  return [...weeks].map(([week, days]) => ({ week, days, why }));
}

/** Validates a change { from?, sessions: [{day, kind, title, meta?}], why } → cleaned copy, or throws. */
export function cleanChange(c, from = 0) {
  if (!c || !Array.isArray(c.sessions) || c.sessions.length > 10) throw new Error("plan change: bad sessions");
  const sessions = c.sessions.map((x) => {
    const day = String(x?.day || "").slice(0, 3);
    if (!(day in DAY_INDEX) || DAY_INDEX[day] < from) throw new Error("plan change: bad day");
    if (!(x.kind in KIND_COLOR)) throw new Error("plan change: bad kind");
    const title = txt(x.kind === "Rest" ? x.title || "Rest" : x.title, 50, "title");
    if (!title) throw new Error("plan change: no title");
    return { day, kind: x.kind, title, meta: txt(x.meta, 40, "note") };
  }).sort((x, y) => DAY_INDEX[x.day] - DAY_INDEX[y.day]);
  return { from, sessions, why: txt(c.why, 200, "reason") };
}
