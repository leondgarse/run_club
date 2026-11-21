// /api/activities — a runner's own log of sessions, on or off the plan.
//   GET    ?person=&from=YYYY-MM-DD&to=YYYY-MM-DD -> { activities: [...], logs: [progress rows for weeks in range] }
//   POST   { person, id?, date, type, title, km, duration, pace, hr, cadence, note, extra?, week?, item? } -> { ok, activity }
//          extra: the "Additional" fields (EXTRA below). Keys not listed there that are already stored are kept.
//          week+item: the plan session these are the details of. Its tick is kept and gets km/time/pace/HR/note too,
//          so the plan's checks see them; the activity is what shows in My log (with up to 3 photos, ./actphoto.js).
//          Without week+item, a run/gym/swim is matched to the plan session it most likely was (lib/match.js: same
//          day, a day late or a day early) and ticks it, so a session moved by a day still counts. `today` (the
//          runner's date) decides whether a session's day is over.
//   POST   { person, relink: true, date, today? } -> re-plan those automatic links around `date` (backfill).
//   DELETE ?person=&id=   (also its photos; a linked session stays ticked)
import { DATE, HttpError, ITEM, PEOPLE, fromQuery, handle, json } from "../../lib/shared.js";
import { TEXT_RULES } from "../../lib/rules.js";
import { TYPES as MATCH_TYPES, assignSessions, shift, windowWeeks } from "../../lib/match.js";

/**
 * Re-plan the automatic session links around `date` (lib/match.js): activities without a hand-made link (and not
 * un-ticked by the runner, extra.nolink) are matched to plan sessions; links made by hand and hand ticks stay.
 * A newly matched session is ticked with the activity's numbers; one that loses its automatic match is un-ticked.
 */
async function relink(env, p, date, today) {
  const weeks = windowWeeks(date), marks = weeks.map(() => "?").join(",");
  const [actsR, ticksR, chR, skipR] = await env.DB.batch([
    env.DB.prepare("SELECT id, date, type, title, note, km, duration, pace, hr, extra, week, item FROM activities " +
      "WHERE person=?1 AND date BETWEEN ?2 AND ?3").bind(p, shift(date, -8), shift(date, 8)),
    env.DB.prepare(`SELECT week, item FROM progress WHERE person=?1 AND week IN (${marks})`).bind(p, ...weeks),
    env.DB.prepare(`SELECT week, data FROM plan_changes WHERE person=?1 AND week IN (${marks})`).bind(p, ...weeks),
    env.DB.prepare(`SELECT week, item FROM auto_skip WHERE person=?1 AND week IN (${marks})`).bind(p, ...weeks),
  ]);
  const ex = (a) => { try { return JSON.parse(a.extra || "{}"); } catch { return {}; } };
  const auto = actsR.results.filter((a) => MATCH_TYPES.includes(a.type) && !ex(a).nolink && (!a.week || ex(a).autolink));
  const manual = actsR.results.filter((a) => a.week && !ex(a).autolink);
  const before = new Map(auto.filter((a) => a.week).map((a) => [a.id, `${a.week}|${a.item}`]));
  const autoKeys = new Set(before.values());
  const changes = {};
  for (const c of chR.results) try { changes[`${p}|${c.week}`] = JSON.parse(c.data); } catch {}
  const taken = (w) => new Set([...ticksR.results.filter((r) => !autoKeys.has(`${r.week}|${r.item}`)), ...manual, ...skipR.results]
    .filter((r) => r.week === w).map((r) => r.item));
  const after = assignSessions(p, auto, weeks.map((w) => ({ week: w, taken: taken(w) })), changes, today);
  const now = new Date().toISOString(), stmts = [];
  const gained = new Set([...after.values()].map((m) => `${m.week}|${m.item}`));
  for (const key of autoKeys) if (!gained.has(key)) { // lost its automatic match: un-tick
    const [w, it] = key.split("|");
    stmts.push(env.DB.prepare("DELETE FROM progress WHERE person=?1 AND week=?2 AND item=?3").bind(p, w, it));
  }
  for (const a of auto) {
    const m = after.get(a.id), key = m ? `${m.week}|${m.item}` : null;
    if (key === (before.get(a.id) || null)) continue;
    stmts.push(env.DB.prepare("UPDATE activities SET week=?2, item=?3, extra=" +
      (m ? "json_set(COALESCE(extra, '{}'), '$.autolink', 1)" : "json_remove(extra, '$.autolink')") + " WHERE id=?1")
      .bind(a.id, m?.week || null, m?.item || null));
    if (m) stmts.push(env.DB.prepare(
      "INSERT INTO progress (person, week, item, done_at, km, duration, pace, hr, note, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?4) " +
      "ON CONFLICT(person, week, item) DO UPDATE SET km=excluded.km, duration=excluded.duration, pace=excluded.pace, " +
      "hr=excluded.hr, note=excluded.note, updated_at=excluded.updated_at",
    ).bind(p, m.week, m.item, now, a.km, a.duration, a.pace, a.hr, a.note));
  }
  if (stmts.length) await env.DB.batch(stmts);
}

/** The runner's date from the request (their phone's), else UTC's. */
const runnerToday = (t) => (DATE.test(t || "") && Math.abs(Date.parse(t + "T12:00:00Z") - Date.now()) <= 36 * 3600e3
  ? t : new Date().toISOString().slice(0, 10));

/** Free text checked against lib/rules.js TEXT_RULES: rejected (not silently changed) if it breaks the rule. */
function text(k, v) {
  if (v == null) return null;
  const s = String(v).normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!s) return null;
  const r = TEXT_RULES[k];
  if (s.length > r.max || !r.re.test(s)) throw new HttpError(400, `${k.replace("_", " ")}: ${r.hint}`);
  return s;
}

const TYPES = new Set(["run", "gym", "swim", "bike", "hike", "other"]);
const TIME = /^(\d{1,2}:)?\d{1,2}:\d{2}$/;
const PACE = /^\d{1,2}:\d{2}$/;
const COLS = "id, person, date, type, title, km, duration, pace, hr, cadence, note, extra, created_at, updated_at, week, item, " +
  "(SELECT group_concat(idx) FROM activity_photos ph WHERE ph.activity_id = activities.id) AS photo_idx";

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
  start: /^([01]?\d|2[0-3]):[0-5]\d$/, splits: "text", split_hr: "text", weather: "text",
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
    } else { const t = text(k, v); if (t) out[k] = t; }
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

/** Keep the linked session ticked, with the activity's headline numbers. */
async function tick(env, p, a, now) {
  await env.DB.prepare(
    "INSERT INTO progress (person, week, item, done_at, km, duration, pace, hr, note, updated_at) " +
    "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?4) " +
    "ON CONFLICT(person, week, item) DO UPDATE SET km=excluded.km, duration=excluded.duration, " +
    "pace=excluded.pace, hr=excluded.hr, note=excluded.note, updated_at=excluded.updated_at",
  ).bind(p, a.week, a.item, now, a.km, a.duration, a.pace, a.hr, a.note).run();
  return env.DB.prepare("SELECT person, week, item, done_at, km, duration, pace, hr, note, has_photo, updated_at " +
    "FROM progress WHERE person=?1 AND week=?2 AND item=?3").bind(p, a.week, a.item).first();
}

function clean(b) {
  if (!DATE.test(b.date || "")) throw new HttpError(400, "bad date");
  if (b.date > new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10)) throw new HttpError(400, "date is in the future");
  if (!TYPES.has(b.type)) throw new HttpError(400, "bad type");
  const a = {
    date: b.date, type: b.type,
    title: text("title", b.title),
    km: num(b.km, 0.01, 300, "distance", 100),
    duration: null, pace: null,
    hr: num(b.hr, 40, 230, "heart rate"),
    cadence: num(b.cadence, 60, 240, "cadence"),
    // Notes stay free text (they carry "left knee sore" etc.) but are capped and stripped of control characters;
    // the prompt quotes them as untrusted data.
    note: b.note ? String(b.note).replace(/[\p{Cc}\p{Cf}]/gu, " ").trim().slice(0, 300) || null : null,
  };
  if (b.duration) { if (!TIME.test(b.duration)) throw new HttpError(400, "bad time"); a.duration = b.duration; }
  if (b.pace) { if (!PACE.test(b.pace)) throw new HttpError(400, "bad pace"); a.pace = b.pace; }
  a.week = a.item = null;
  if (b.week || b.item) {
    if (!DATE.test(b.week || "") || !ITEM.test(b.item || "")) throw new HttpError(400, "bad session link");
    a.week = b.week; a.item = b.item;
  }
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
  if (b.relink) {
    if (!DATE.test(b.date || "")) throw new HttpError(400, "bad date");
    await relink(env, p, b.date, runnerToday(b.today));
    return json({ ok: true });
  }
  const a = clean(b);
  const now = new Date().toISOString();
  let id = b.id != null ? Number(b.id) : null, keepAuto = false;
  if (!id && a.week) { // one activity per plan session: a second "new" one for the same session updates the first
    const linked = await env.DB.prepare("SELECT id FROM activities WHERE person=?1 AND week=?2 AND item=?3").bind(p, a.week, a.item).first();
    if (linked) id = linked.id;
  }
  if (id) {
    const old = await env.DB.prepare("SELECT extra, week, item FROM activities WHERE id=?1 AND person=?2").bind(id, p).first();
    if (!old) throw new HttpError(404, "activity not found");
    try { // the form sends back an automatic link unchanged: it stays automatic
      if (JSON.parse(old.extra || "{}").autolink && a.week === old.week && a.item === old.item) keepAuto = true;
    } catch {}
    const extra = cleanExtra(b.extra, old.extra);
    await env.DB.prepare(
      "UPDATE activities SET date=?3, type=?4, title=?5, km=?6, duration=?7, pace=?8, hr=?9, cadence=?10, note=?11, extra=?12, updated_at=?13, " +
      "week=?14, item=?15 WHERE id=?1 AND person=?2"
    ).bind(id, p, a.date, a.type, a.title, a.km, a.duration, a.pace, a.hr, a.cadence, a.note, extra, now, a.week, a.item).run();
  } else {
    const r = await env.DB.prepare(
      "INSERT INTO activities (person, date, type, title, km, duration, pace, hr, cadence, note, extra, created_at, updated_at, week, item) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, ?13, ?14)"
    ).bind(p, a.date, a.type, a.title, a.km, a.duration, a.pace, a.hr, a.cadence, a.note, cleanExtra(b.extra, null), now, a.week, a.item).run();
    id = r.meta.last_row_id;
  }
  if (a.week && !keepAuto) { // linked by hand: no longer an automatic link
    await env.DB.prepare("UPDATE activities SET extra=json_remove(extra, '$.autolink') WHERE id=?1 AND extra IS NOT NULL").bind(id).run();
  }
  const row = a.week ? await tick(env, p, a, now) : null;
  await relink(env, p, a.date, runnerToday(b.today));
  const activity = await env.DB.prepare(`SELECT ${COLS} FROM activities WHERE id=?1`).bind(id).first();
  return json({ ok: true, activity, row });
});

export const onRequestDelete = handle(async ({ request, env }) => {
  const q = fromQuery(request);
  const p = person(q.person);
  const id = Number(q.id);
  if (!(id > 0)) throw new HttpError(400, "bad id");
  const own = await env.DB.prepare("SELECT date, extra, week, item FROM activities WHERE id=?1 AND person=?2").bind(id, p).first();
  if (!own) return json({ ok: true });
  let auto = false;
  try { auto = !!JSON.parse(own.extra || "{}").autolink; } catch {}
  await env.DB.batch([
    env.DB.prepare("DELETE FROM activity_photos WHERE activity_id=?1").bind(id),
    env.DB.prepare("DELETE FROM activities WHERE id=?1 AND person=?2").bind(id, p),
    // its automatic tick goes with it (a session linked by hand stays ticked)
    ...(auto && own.week ? [env.DB.prepare("DELETE FROM progress WHERE person=?1 AND week=?2 AND item=?3").bind(p, own.week, own.item)] : []),
  ]);
  await relink(env, p, own.date, runnerToday(q.today));
  return json({ ok: true });
});
