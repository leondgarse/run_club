// A session done on another day than planned still counts. Activities saved without a session link (run/gym/swim)
// are matched to the plan sessions they most likely were: same type, not ticked or linked by hand, and in passes:
// the same day, then done a day late, then a day early (early only once that session's day is over: the runner may
// still do it). Tests and races only take an activity that says so (title/note), and such activities are placed
// first. The whole neighbourhood is re-planned on every save, so the result doesn't depend on the order runs were
// entered (e.g. Wed + Fri runs and a Thu session: Fri takes Thu, as "done a day late").
import { assignSessions } from "../public/plans.js";
export { assignSessions };

export const shift = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
export const mondayOf = (d) => shift(d, -((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7));
export const TYPES = ["run", "gym", "swim"];

/** Weeks around a date whose sessions an activity in the ±8-day window could match. */
export const windowWeeks = (date) => [...new Set([-14, -7, 0, 7].map((n) => mondayOf(shift(date, n))))];

