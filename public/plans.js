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

/** @returns {{title, sub, items, notes?} | {empty: string}} */
export function planFor(person, week) {
  if (person === "TJH") {
    const n = weeksBetween(TJH_START, week);
    if (n < 0) return { empty: `The 8-week plan starts the week of ${TJH_START}.` };
    if (n >= TJH_WEEKS.length) return { empty: "8-week plan finished 🎉 Time for a new goal." };
    const w = TJH_WEEKS[n];
    return {
      title: `Week ${n + 1} of 8` + (w.tag ? ` · ${w.tag}` : ""),
      sub: `~${w.km} km · Tue · Thu · Sat · Sun`,
      items: toItems(w.s, tjhTarget),
      notes: TJH_NOTES,
    };
  }
  if (person === "WGW") {
    return { title: "My Running Week", sub: "3 runs · pace min/km · HR bpm", items: toItems(WGW_WEEK) };
  }
  if (person === "SJH") {
    const w = SJH_WEEKS[week];
    if (!w) return { empty: "No plan entered for this week yet — add it to SJH_WEEKS in plans.js." };
    return { title: w.label, sub: `${w.km} km running`, items: toItems(w.s) };
  }
  return { empty: "Unknown runner." };
}
