// A session done on another day than planned still counts. Activities saved without a session link (run/gym/swim)
// are matched to the plan sessions they most likely were: same type, not ticked or linked by hand, and in passes:
// the same day, then done a day late, then a day early (early only once that session's day is over: the runner may
// still do it). Tests and races only take an activity that says so (title/note), and such activities are placed
// first. The whole neighbourhood is re-planned on every save, so the result doesn't depend on the order runs were
// entered (e.g. Wed + Fri runs and a Thu session: Fri takes Thu, as "done a day late").
import { planFor } from "../public/plans.js";

export const shift = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
export const mondayOf = (d) => shift(d, -((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7));
const typeOf = (kind) => (/strength/i.test(kind) ? "gym" : /swim/i.test(kind) ? "swim" : "run");
const TEST_KIND = /^(test|race)$/i;
const SAYS_TEST = /\b(test|race|time trial|TT)\b|测试|比赛/i;
export const TYPES = ["run", "gym", "swim"];

/** Weeks around a date whose sessions an activity in the ±8-day window could match. */
export const windowWeeks = (date) => [...new Set([-14, -7, 0, 7].map((n) => mondayOf(shift(date, n))))];

/**
 * @param person
 * @param acts     activities free to (re)match: [{ id, date, type, title, note }]
 * @param weeks    [{ week, taken: Set(item ids ticked or linked by hand) }]
 * @param changes  accepted plan changes { "TJH|2026-11-16": {...} }
 * @param today    the runner's date
 * @returns Map(activity id → { week, item })
 */
export function assignSessions(person, acts, weeks, changes, today) {
  const sessions = [];
  for (const w of weeks) {
    for (const it of planFor(person, w.week, changes).items || []) {
      if (it.rest || w.taken.has(it.id)) continue;
      sessions.push({ week: w.week, item: it.id, date: shift(w.week, it.dayIndex), type: typeOf(it.kind), test: TEST_KIND.test(it.kind) });
    }
  }
  sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const out = new Map(), used = new Set();
  const free = [...acts].filter((a) => TYPES.includes(a.type)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const says = (a) => SAYS_TEST.test(`${a.title || ""} ${a.note || ""}`);
  for (const testPass of [true, false]) {
    for (const lag of [0, 1, -1]) { // same day, a day late, a day early
      for (const s of sessions) {
        if (used.has(`${s.week}|${s.item}`) || (testPass && !s.test)) continue;
        if (lag === -1 && !(s.date < today)) continue;
        const a = free.find((x) => !out.has(x.id) && x.type === s.type && x.date === shift(s.date, lag) && (!s.test || says(x)) &&
          (testPass ? says(x) : true));
        if (!a) continue;
        out.set(a.id, { week: s.week, item: s.item });
        used.add(`${s.week}|${s.item}`);
      }
    }
  }
  return out;
}
