// Plan changes for TJH/WGW: Claude proposes one in the daily suggestion (`plan_change`), the runner accepts it here.
//   GET  /api/plan?from=&to=                              -> { changes: { "TJH|2026-11-16": {days, why, source_date} } }
//   POST /api/plan { person, today, change, source }      -> { changes: { "WGW|2026-11-16": {...}, "WGW|2026-11-23": {...} } }
//        accept: change = {start, end, why, sessions: [{date, kind, title, meta}]} (or the older {week, from, ...});
//        re-validated and split per week by splitChange (public/plans.js). Each week stores the days it replaces, so a
//        new change merges with one accepted earlier in that week; days already past never change.
//   POST /api/plan { person, week, revert: true }         -> { change: null }   back to the original week
import { DATE, HttpError, fromQuery, handle, json } from "../../lib/shared.js";
import { CHANGEABLE, changeDays, splitChange } from "../../public/plans.js";

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
  if (!CHANGEABLE.has(b.person)) throw new HttpError(400, "bad input");
  if (b.revert) {
    if (!DATE.test(b.week || "")) throw new HttpError(400, "bad input");
    await env.DB.prepare("DELETE FROM plan_changes WHERE person=?1 AND week=?2").bind(b.person, b.week).run();
    return json({ change: null });
  }
  const today = b.today;
  if (!DATE.test(today || "") || Math.abs(Date.parse(today + "T12:00:00Z") - Date.now()) > 36 * 3600e3) throw new HttpError(400, "bad date");
  let parts;
  try { parts = splitChange(b.change, today); } catch (e) {
    throw new HttpError(400, /passed/.test(e.message) ? "This proposal is out of date (its days have passed)" : e.message);
  }
  const source = DATE.test(b.source || "") ? b.source : null, now = new Date().toISOString();
  const marks = parts.map(() => "?").join(",");
  const { results } = await env.DB.prepare(`SELECT week, data FROM plan_changes WHERE person=?1 AND week IN (${marks})`)
    .bind(b.person, ...parts.map((x) => x.week)).all();
  const old = Object.fromEntries(results.map((r) => { try { return [r.week, JSON.parse(r.data)]; } catch { return [r.week, null]; } }));
  const changes = {}, stmts = [];
  for (const { week, days, why } of parts) {
    const data = { days: { ...(old[week] ? changeDays(old[week]) : {}), ...days }, why };
    changes[`${b.person}|${week}`] = { ...data, source_date: source };
    stmts.push(env.DB.prepare(
      "INSERT INTO plan_changes (person, week, data, source_date, accepted_at) VALUES (?1, ?2, ?3, ?4, ?5) " +
      "ON CONFLICT(person, week) DO UPDATE SET data=?3, source_date=?4, accepted_at=?5",
    ).bind(b.person, week, JSON.stringify(data), source, now));
  }
  await env.DB.batch(stmts);
  return json({ changes });
});
