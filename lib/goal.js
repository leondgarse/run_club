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
