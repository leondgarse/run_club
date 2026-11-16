// /api/activities — a runner's own log of sessions, on or off the plan.
//   GET    ?person=&from=YYYY-MM-DD&to=YYYY-MM-DD -> { activities: [...], logs: [progress rows for weeks in range] }
//   POST   { person, id?, date, type, title, km, duration, pace, hr, cadence, note, extra? } -> { ok, activity }
//          extra: the "Additional" fields (EXTRA below). Keys not listed there that are already stored are kept.
//   DELETE ?person=&id=
import { DATE, HttpError, PEOPLE, fromQuery, handle, json } from "../../lib/shared.js";

const TYPES = new Set(["run", "gym", "swim", "bike", "hike", "other"]);
const TIME = /^(\d{1,2}:)?\d{1,2}:\d{2}$/;
const PACE = /^\d{1,2}:\d{2}$/;
const COLS = "id, person, date, type, title, km, duration, pace, hr, cadence, note, extra, created_at, updated_at";

function person(v) {
  if (!PEOPLE.has(v)) throw new HttpError(400, "bad person");
  return v;
}
function num(v, lo, hi, what, round = 1) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!(n >= lo && n <= hi)) throw new HttpError(400, `${what} out of range`);
  return Math.round(n * round) / round;
}

// Additional per-activity fields: key -> [min, max, decimals] for numbers, or a max length for text.
const EXTRA = {
  max_hr: [60, 230, 0], stride_m: [0.3, 2.5, 2], gct_ms: [120, 450, 0], vert_osc_cm: [2, 20, 1],
  lr_balance: [40, 60, 1], power_w: [30, 900, 0], elev_m: [0, 5000, 0], training_load: [0, 1000, 0],
  start: /^([01]?\d|2[0-3]):[0-5]\d$/, splits: 300, split_hr: 200, weather: 60,
};

function cleanExtra(x, old) {
  const out = {};
  try { Object.assign(out, old ? JSON.parse(old) : {}); } catch {}
  for (const k of Object.keys(EXTRA)) delete out[k]; // listed keys come only from the form
  for (const [k, rule] of Object.entries(EXTRA)) {
    let v = x?.[k];
    if (v == null || v === "") continue;
    if (Array.isArray(rule)) {
      if (k === "lr_balance" && typeof v === "string") v = v.split("/")[0]; // "51.1/48.9" -> left %
      const n = Number(String(v).replace(",", "."));
      if (!(n >= rule[0] && n <= rule[1])) throw new HttpError(400, `${k.replace(/_/g, " ")} out of range`);
      out[k] = Math.round(n * 10 ** rule[2]) / 10 ** rule[2];
    } else if (rule instanceof RegExp) {
      if (!rule.test(String(v).trim())) throw new HttpError(400, `bad ${k}`);
      out[k] = String(v).trim();
    } else out[k] = String(v).trim().slice(0, rule);
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

function clean(b) {
  if (!DATE.test(b.date || "")) throw new HttpError(400, "bad date");
  if (b.date > new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10)) throw new HttpError(400, "date is in the future");
  if (!TYPES.has(b.type)) throw new HttpError(400, "bad type");
  const a = {
    date: b.date, type: b.type,
    title: b.title ? String(b.title).trim().slice(0, 80) || null : null,
    km: num(b.km, 0.01, 300, "distance", 100),
    duration: null, pace: null,
    hr: num(b.hr, 40, 230, "heart rate"),
    cadence: num(b.cadence, 60, 240, "cadence"),
    note: b.note ? String(b.note).slice(0, 500) : null,
  };
  if (b.duration) { if (!TIME.test(b.duration)) throw new HttpError(400, "bad time"); a.duration = b.duration; }
  if (b.pace) { if (!PACE.test(b.pace)) throw new HttpError(400, "bad pace"); a.pace = b.pace; }
  return a;
}

export const onRequestGet = handle(async ({ request, env }) => {
  const q = fromQuery(request);
  const p = person(q.person);
  if (!DATE.test(q.from || "") || !DATE.test(q.to || "")) throw new HttpError(400, "bad range");
  const [acts, logs] = await env.DB.batch([
    env.DB.prepare(`SELECT ${COLS} FROM activities WHERE person=?1 AND date BETWEEN ?2 AND ?3 ORDER BY date DESC, id DESC`)
      .bind(p, q.from, q.to),
    env.DB.prepare("SELECT week, item, km, duration, pace, hr, updated_at FROM progress WHERE person=?1 AND week BETWEEN ?2 AND ?3")
      .bind(p, q.from, q.to),
  ]);
  return json({ activities: acts.results, logs: logs.results });
});

export const onRequestPost = handle(async ({ request, env }) => {
  const b = await request.json().catch(() => { throw new HttpError(400, "bad json"); });
  const p = person(b.person);
  const a = clean(b);
  const now = new Date().toISOString();
  let id = b.id != null ? Number(b.id) : null;
  if (id) {
    const old = await env.DB.prepare("SELECT extra FROM activities WHERE id=?1 AND person=?2").bind(id, p).first();
    if (!old) throw new HttpError(404, "activity not found");
    const extra = cleanExtra(b.extra, old.extra);
    await env.DB.prepare(
      "UPDATE activities SET date=?3, type=?4, title=?5, km=?6, duration=?7, pace=?8, hr=?9, cadence=?10, note=?11, extra=?12, updated_at=?13 " +
      "WHERE id=?1 AND person=?2"
    ).bind(id, p, a.date, a.type, a.title, a.km, a.duration, a.pace, a.hr, a.cadence, a.note, extra, now).run();
  } else {
    const r = await env.DB.prepare(
      "INSERT INTO activities (person, date, type, title, km, duration, pace, hr, cadence, note, extra, created_at, updated_at) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)"
    ).bind(p, a.date, a.type, a.title, a.km, a.duration, a.pace, a.hr, a.cadence, a.note, cleanExtra(b.extra, null), now).run();
    id = r.meta.last_row_id;
  }
  const activity = await env.DB.prepare(`SELECT ${COLS} FROM activities WHERE id=?1`).bind(id).first();
  return json({ ok: true, activity });
});

export const onRequestDelete = handle(async ({ request, env }) => {
  const q = fromQuery(request);
  const p = person(q.person);
  const id = Number(q.id);
  if (!(id > 0)) throw new HttpError(400, "bad id");
  await env.DB.prepare("DELETE FROM activities WHERE id=?1 AND person=?2").bind(id, p).run();
  return json({ ok: true });
});
