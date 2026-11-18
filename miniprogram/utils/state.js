// State shared by all pages (modules are loaded once, so this object lives for the whole session).
import { PEOPLE, planFor as basePlanFor } from "../shared/plans.js";
import { thisWeek } from "./dates.js";

export { PEOPLE };
export const S = {
  tab: null,
  week: thisWeek(),
  done: new Map(), // "TJH|2026-11-16" -> Set(itemId)
  logs: new Map(), // "TJH|2026-11-16|tue" -> progress row
  loaded: new Set(),
  online: true,
  lastSync: null,
  wgw: null, // public Garmin summary for WGW (wgw.json)
  hist: new Map(), // "SJH" -> { activities, logs, at, ready }
  today: new Map(), // "SJH" -> { suggestion, newer, refresh, date, at, loading, dirty, error }
  goals: {},
  planChanges: {},
};
export const SELF_LOG = new Set(["TJH", "SJH"]);
export const person = (id) => PEOPLE.find((p) => p.id === id);
export const planFor = (p, w) => basePlanFor(p, w, S.planChanges);
export function doneSet(p, w) {
  const k = `${p}|${w}`;
  if (!S.done.has(k)) S.done.set(k, new Set());
  return S.done.get(k);
}
export const logOf = (p, w, i) => S.logs.get(`${p}|${w}|${i}`);
/** New sessions: refetch history and let the server decide whether today's suggestion needs rewriting. */
export function dataChanged(p) {
  const t = S.today.get(p); if (t) t.dirty = true;
  const h = S.hist.get(p); if (h) h.at = 0;
}
export const linkedAct = (p, w, item) => S.hist.get(p)?.activities.find((a) => a.week === w && a.item === item) || null;
export const parseExtra = (a) => { try { return a?.extra ? JSON.parse(a.extra) : {}; } catch { return {}; } };
