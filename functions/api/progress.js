// /api/progress
//   GET  ?from=YYYY-MM-DD&to=YYYY-MM-DD           -> { rows: [...] }
//   POST { person, week, item, done, log? }       -> { ok, row? }
//        done:false removes the tick (and its photo; a linked activity is unlinked); log:{km,duration,pace,hr,note} saves details.
import { DATE, HttpError, handle, json, key } from "../../lib/shared.js";

const COLS = "person, week, item, done_at, km, duration, pace, hr, note, has_photo, updated_at";
const TIME = /^(\d{1,2}:)?\d{1,2}:\d{2}$/;
const PACE = /^\d{1,2}:\d{2}$/;

function cleanLog(l) {
  const out = { km: null, duration: null, pace: null, hr: null, note: null };
  if (l.km != null && l.km !== "") {
    const km = Number(l.km);
    if (!(km > 0 && km <= 200)) throw new HttpError(400, "distance out of range");
    out.km = Math.round(km * 100) / 100;
  }
  if (l.duration) { if (!TIME.test(l.duration)) throw new HttpError(400, "bad time"); out.duration = l.duration; }
  if (l.pace) { if (!PACE.test(l.pace)) throw new HttpError(400, "bad pace"); out.pace = l.pace; }
  if (l.hr != null && l.hr !== "") {
    const hr = Math.round(Number(l.hr));
    if (!(hr >= 40 && hr <= 230)) throw new HttpError(400, "heart rate out of range");
    out.hr = hr;
  }
  if (l.note) out.note = String(l.note).slice(0, 500);
  return out;
}

export const onRequestGet = handle(async ({ request, env }) => {
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to") || from;
  if (!DATE.test(from || "") || !DATE.test(to || "")) throw new HttpError(400, "bad range");
  const { results } = await env.DB.prepare(`SELECT ${COLS} FROM progress WHERE week BETWEEN ?1 AND ?2`)
    .bind(from, to).all();
  return json({ rows: results });
});

export const onRequestPost = handle(async ({ request, env }) => {
  const body = await request.json().catch(() => { throw new HttpError(400, "bad json"); });
  const { person, week, item } = key(body || {});
  const now = new Date().toISOString();

  if (!body.done) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM progress WHERE person=?1 AND week=?2 AND item=?3").bind(person, week, item),
      env.DB.prepare("DELETE FROM photos WHERE person=?1 AND week=?2 AND item=?3").bind(person, week, item),
      // An activity linked to it stays in My log, unlinked; the session is never matched automatically again.
      env.DB.prepare("UPDATE activities SET week=NULL, item=NULL, extra=json_remove(extra, '$.autolink') " +
        "WHERE person=?1 AND week=?2 AND item=?3").bind(person, week, item),
      env.DB.prepare("INSERT OR IGNORE INTO auto_skip (person, week, item) VALUES (?1, ?2, ?3)").bind(person, week, item),
    ]);
    return json({ ok: true });
  }

  await env.DB.prepare("DELETE FROM auto_skip WHERE person=?1 AND week=?2 AND item=?3").bind(person, week, item).run();
  if (!body.log) {
    await env.DB.prepare(
      "INSERT INTO progress (person, week, item, done_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4) " +
      "ON CONFLICT(person, week, item) DO NOTHING"
    ).bind(person, week, item, now).run();
  } else {
    const l = cleanLog(body.log);
    await env.DB.prepare(
      "INSERT INTO progress (person, week, item, done_at, km, duration, pace, hr, note, updated_at) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?4) " +
      "ON CONFLICT(person, week, item) DO UPDATE SET km=excluded.km, duration=excluded.duration, " +
      "pace=excluded.pace, hr=excluded.hr, note=excluded.note, updated_at=excluded.updated_at"
    ).bind(person, week, item, now, l.km, l.duration, l.pace, l.hr, l.note).run();
  }
  const row = await env.DB.prepare(`SELECT ${COLS} FROM progress WHERE person=?1 AND week=?2 AND item=?3`)
    .bind(person, week, item).first();
  return json({ ok: true, row });
});
