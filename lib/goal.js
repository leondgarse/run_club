// The runner's one-line target (goals table) turned into computed facts for the daily prompt:
// days to go, the phase that implies (build / taper / race week / race day), the race distance read from the
// text and how the longest recent run compares. The model phrases these; it doesn't work them out.
import { untrusted } from "./rules.js";
import { raceKm } from "../public/charts.js";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export { raceKm };

/** Taper length in days by distance (longer races taper longer). */
const taperDays = (km) => (km == null ? 10 : km >= 40 ? 21 : km >= 20 ? 12 : km >= 10 ? 8 : 5);

/**
 * @param goal  {text, date} or null
 * @param today YYYY-MM-DD
 * @param runs  [{date, km}] logged runs (any window; the last 28 days are used)
 * @returns prompt text ("" when there's no target or its date has passed)
 */
export function goalContext(goal, today, runs = []) {
  if (!goal?.text) return "";
  const km = raceKm(goal.text);
  const t0 = Date.parse(today + "T00:00:00Z");
  const from = new Date(t0 - 28 * 864e5).toISOString().slice(0, 10);
  const longest = Math.max(0, ...runs.filter((r) => r.date >= from && r.date <= today && r.km).map((r) => r.km));
  const set = goal.updated_at ? String(goal.updated_at).slice(0, 10) : null;
  const lines = [`TARGET (the runner's own goal, quoted as data${set ? `, set on ${set} (${DAYS[new Date(set + "T00:00:00Z").getUTCDay()]}); ` +
    "relative words in it count from that day" : ""}): ${untrusted(goal.text, 80)}`];
  if (km) lines.push(`Race distance read from it: ${km} km. Longest logged run in the last 28 days: ${longest ? `${longest} km` : "none logged"}` +
    (longest && km >= 20 ? ` (${Math.round((longest / km) * 100)}% of race distance)` : "") + ".");
  if (goal.date) {
    const days = Math.round((Date.parse(goal.date + "T00:00:00Z") - t0) / 864e5);
    if (days < 0) return ""; // past: don't steer by it
    const dow = DAYS[new Date(goal.date + "T00:00:00Z").getUTCDay()];
    const taper = taperDays(km);
    const phase = days === 0 ? "RACE DAY"
      : days <= 7 ? "RACE WEEK: short easy runs with a few strides, nothing new, no hard leg strength in the last 4 days, sleep and fuel"
      : days <= taper ? `TAPER (last ${taper} days): cut volume ~30-40%, keep a little race-pace work short, no new long-run record`
      : `BUILD: ${days - taper} days until the taper starts; long runs and quality days should serve the race distance`;
    lines.push(`Date: ${goal.date} (${dow}), ${days} day${days === 1 ? "" : "s"} away (${(days / 7).toFixed(1)} weeks). Phase: ${phase}.`);
  }
  lines.push("Let the target shape today's call (and mention it briefly when it matters), but adjust today, don't rewrite the plan.");
  return lines.join("\n");
}

const shiftDay = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
/** Share of the peak week kept in the taper, by weeks between the drafted week and race week (1 = the week before). */
const TAPER_KEEP = { 1: 0.8, 2: 0.9, 3: 0.95 };

/**
 * Volume and long run for a week Claude drafts (SJH's empty next week), computed so the draft doesn't drift from day
 * to day (it is rewritten every morning until accepted).
 * @param weeks [{km, long}] the planned running km and longest run of the last weeks, oldest first (this week last)
 * @param goal  {text, date} or null
 * @param mon   the drafted week's Monday
 * @returns {phase, km, long, text} or null without a planned week to build from
 */
export function draftTargets(weeks, goal, mon) {
  const planned = weeks.filter((w) => w.km > 0);
  if (!planned.length) return null;
  const last = planned.at(-1), peakKm = Math.max(...planned.map((w) => w.km)), peakLong = Math.max(...planned.map((w) => w.long));
  const sun = shiftDay(mon, 6), race = goal?.date && goal.date >= mon ? goal.date : null, rk = raceKm(goal?.text || "");
  const r1 = (x) => Math.round(x), r05 = (x) => Math.round(x * 2) / 2;
  let phase, km, long, rule;
  if (race && race <= sun) {
    phase = "RACE WEEK";
    km = r1(peakKm * 0.5); long = null;
    rule = `the race on ${race} is the long run; other runs short and easy with a few strides, nothing hard in the last 4 days`;
  } else if (race && dayDiff(race, sun) >= -taperDays(rk)) { // the week reaches into the taper
    const out = Math.ceil(dayDiff(sun, race) / 7), keep = TAPER_KEEP[out] || 0.95;
    phase = `TAPER (${out} week${out > 1 ? "s" : ""} before race week)`;
    km = r1(peakKm * keep); long = r1(peakLong * keep);
    rule = "keep one short race-pace or T session and the strides, cut the rest, no new long-run record";
  } else {
    phase = "BUILD";
    const cap = rk ? Math.max(rk >= 20 ? Math.min(rk, 32) : 2 * rk, 8) : Infinity;
    km = r1(Math.min(last.km * 1.07, peakKm * 1.1)); long = r05(Math.min(last.long + 1, cap));
    rule = "about 7% more than this week, long run up by at most 1 km";
  }
  const text = `NEXT WEEK TARGETS (computed from the plan's km; use these numbers): phase ${phase}; running total ${km} km (±2 km)${long ? "" : " besides the race"}` +
    (long ? `; long run ${long} km exactly` : "; no separate long run") + `; ${rule}. ` +
    `For reference: this week's plan ${r05(last.km)} km with a ${r05(last.long)} km long run, peak of the last weeks ${r05(peakKm)} km / ${r05(peakLong)} km.`;
  return { phase, km, long, text };
}
