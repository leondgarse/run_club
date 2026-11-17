// Plan changes for TJH/WGW: Claude proposes one in the daily suggestion (`plan_change`), the runner accepts it here.
//   GET  /api/plan?from=&to=                                   -> { changes: { "TJH|2026-11-16": {from, sessions, why, source_date} } }
//   POST /api/plan { person, today, week, change, source }     -> { change }   accept (re-validated here)
//   POST /api/plan { person, week, revert: true }              -> { change: null }   back to the original week
// Only this week (days from today on) or next week can change, so ticked past sessions never move.
import { DATE, HttpError, fromQuery, handle, json } from "../../lib/shared.js";
import { CHANGEABLE, cleanChange } from "../../public/plans.js";

const shift = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const dayIdx = (d) => (new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7;

export const onRequestGet = handle(async ({ request, env }) => {
  const { from, to } = fromQuery(request);
  if (!DATE.test(from || "") || !DATE.test(to || "")) throw new HttpError(400, "bad range");
  const { results } = await env.DB.prepare("SELECT person, week, data, source_date FROM plan_changes WHERE week BETWEEN ?1 AND ?2")
    .bind(from, to).all();
  const changes = {};
  for (const r of results) try { changes[`${r.person}|${r.week}`] = { ...JSON.parse(r.data), source_date: r.source_date }; } catch {}
  return json({ changes });
});

export const onRequestPost = handle(async ({ request, env }) => {
  const b = await request.json().catch(() => ({}));
  if (!CHANGEABLE.has(b.person) || !DATE.test(b.week || "")) throw new HttpError(400, "bad input");
  if (b.revert) {
    await env.DB.prepare("DELETE FROM plan_changes WHERE person=?1 AND week=?2").bind(b.person, b.week).run();
    return json({ change: null });
  }
  const today = b.today;
  if (!DATE.test(today || "") || Math.abs(Date.parse(today + "T12:00:00Z") - Date.now()) > 36 * 3600e3) throw new HttpError(400, "bad date");
  const thisWeek = shift(today, -dayIdx(today));
  if (b.week !== thisWeek && b.week !== shift(thisWeek, 7)) throw new HttpError(400, "Only this week or next week can change");
  const from = b.week === thisWeek ? dayIdx(today) : 0;
  let change;
  try { change = cleanChange(b.change, from); } catch (e) {
    throw new HttpError(400, /bad day/.test(e.message) ? "This proposal is out of date (its days have passed)" : e.message);
  }
  await env.DB.prepare(
    "INSERT INTO plan_changes (person, week, data, source_date, accepted_at) VALUES (?1, ?2, ?3, ?4, ?5) " +
    "ON CONFLICT(person, week) DO UPDATE SET data=?3, source_date=?4, accepted_at=?5",
  ).bind(b.person, b.week, JSON.stringify(change), DATE.test(b.source || "") ? b.source : null, new Date().toISOString()).run();
  return json({ change: { ...change, source_date: b.source || null } });
});
