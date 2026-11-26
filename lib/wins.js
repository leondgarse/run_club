// Firsts and bests in a runner's latest runs, computed against every run logged before them (CLAUDE.md: numbers are
// computed here; the model only phrases them). They feed the card's "Well done" line, so progress is named, not
// buried in a correction.
import { mmss, sec } from "./week.js";

const shift = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const md = (d) => d.slice(5);
const paceOf = (a) => (a.pace ? sec(a.pace) : a.km && a.duration ? sec(a.duration) / a.km : null);
const MIN_PRIOR = 3; // a "best" needs a few earlier runs to beat

/**
 * @param sessions [{date, type, km, duration, pace, hr, cadence}] (a year is plenty)
 * @param today    YYYY-MM-DD; runs from the last `days` days (today included) are checked
 * @returns ["highest cadence yet: 173 spm on 11-25 (previous best 165 on 11-06)", ...] newest run first
 */
export function wins(sessions, today, days = 2) {
  const runs = sessions.filter((a) => a.type === "run" && a.km > 0 && a.date <= today).sort((a, b) => (a.date < b.date ? -1 : 1));
  const from = shift(today, -(days - 1)), out = [];
  for (const r of runs.filter((a) => a.date >= from).reverse()) {
    const prior = runs.filter((a) => a.date < r.date);
    if (prior.length < MIN_PRIOR) continue;
    const when = `on ${md(r.date)} (${r.km} km)`;
    // Cadence: a new best, and the first time over a round mark (170, 180).
    const cads = prior.filter((a) => a.cadence);
    if (r.cadence && cads.length >= MIN_PRIOR) {
      const best = cads.reduce((x, y) => (y.cadence > x.cadence ? y : x));
      if (r.cadence > best.cadence) {
        const mark = [180, 170, 160].find((m) => r.cadence >= m && best.cadence < m);
        out.push(`highest cadence yet: ${r.cadence} spm ${when}, previous best ${best.cadence} on ${md(best.date)}` +
          (mark ? `; first run ever at ${mark}+ spm` : ""));
      }
    }
    // Longest run.
    const longest = prior.reduce((x, y) => (y.km > x.km ? y : x));
    if (r.km > longest.km * 1.02) out.push(`longest run yet: ${r.km} km ${when.replace(/ \(.*\)/, "")}, previous longest ${longest.km} km on ${md(longest.date)}`);
    // Fastest pace for a run at least this long (5% slack on the distance).
    const p = paceOf(r), same = prior.filter((a) => a.km >= r.km * 0.95 && paceOf(a));
    if (p && r.km >= 3 && same.length) {
      const best = same.reduce((x, y) => (paceOf(y) < paceOf(x) ? y : x));
      if (p < paceOf(best) - 1) out.push(`fastest pace for a run this long: ${mmss(p)}/km ${when}, ` +
        `previous best over ≥${Math.round(r.km * 0.95 * 10) / 10} km ${mmss(paceOf(best))}/km on ${md(best.date)} (${best.km} km)`);
    }
  }
  return out;
}
