// POST /api/extract { person, week, item }      -> { km, duration, pace, hr, cadence, date, type, title }
// POST /api/extract?person=X  (raw image body)  -> same, for the "Add activity" form (image is not stored)
// Reads a watch / Strava / Garmin screenshot with Mistral vision.
import { HttpError, PEOPLE, fromQuery, handle, json, key, mistral, toB64 } from "../../lib/shared.js";

const PROMPT = `This image is a screenshot or photo of a running workout summary (watch, Garmin, Strava, Keep, Coros, etc.).
Extract the totals for the whole run. Reply with JSON only:
{"km": number|null, "duration": "h:mm:ss" or "mm:ss" or null, "pace": "m:ss" (average min per km) or null, "hr": integer average heart rate or null,
 "cadence": integer average steps per minute or null, "date": "YYYY-MM-DD" or null, "type": "run"|"swim"|"bike"|"hike"|"gym"|"other"|null,
 "title": short workout name as shown (e.g. "12.5 km steady long run") or null,
 "extra": {"max_hr": int|null, "vert_osc_cm": number|null (vertical oscillation / 垂直振幅), "stride_m": number|null (avg stride in metres / 步幅; 95 cm = 0.95),
   "gct_ms": int|null (ground contact time / 触地时间), "lr_balance": number|null (LEFT % of L/R balance / 左右触地平衡),
   "power_w": int|null, "elev_m": number|null (elevation gain / 累计爬升), "training_load": int|null,
   "start": "HH:MM" 24h or null, "weather": short text or null,
   "splits": per-km paces separated by spaces, e.g. "5:45 5:07 4:59", or null, "split_hr": per-km avg HR separated by spaces or null}}
Dates like 11/14/26 are month/day/year.
Convert miles to km if needed. Use null for anything not visible. Do not guess.`;

// Loose pass over the model's "extra": keep plausible values; /api/activities validates again on save.
const XNUM = { max_hr: [60, 230], vert_osc_cm: [2, 20], stride_m: [0.3, 2.5], gct_ms: [120, 450], lr_balance: [40, 60],
  power_w: [30, 900], elev_m: [0, 5000], training_load: [0, 1000] };
function cleanExtra(x) {
  if (!x || typeof x !== "object") return {};
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(XNUM)) {
    let n = Number(x[k]);
    if (k === "stride_m" && n > 30) n = n / 100; // cm slipped through
    if (n >= lo && n <= hi) out[k] = n;
  }
  for (const k of ["start", "weather", "splits", "split_hr"]) {
    if (typeof x[k] === "string" && x[k].trim()) out[k] = x[k].trim().slice(0, k === "splits" ? 300 : 200);
  }
  if (out.start && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(out.start)) delete out.start;
  return out;
}

const pick = (v, re) => (typeof v === "string" && re.test(v.trim()) ? v.trim() : null);

export const onRequestPost = handle(async ({ request, env }) => {
  let photo;
  const mime = (request.headers.get("content-type") || "").split(";")[0];
  if (mime.startsWith("image/")) {
    if (!PEOPLE.has(fromQuery(request).person)) throw new HttpError(400, "bad person");
    if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new HttpError(415, "unsupported image type");
    const buf = await request.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > 1.5 * 1024 * 1024) throw new HttpError(413, "image too large");
    photo = { mime, data: toB64(buf) };
  } else {
    const body = await request.json().catch(() => ({}));
    const k = key(body);
    photo = await env.DB.prepare("SELECT mime, data FROM photos WHERE person=?1 AND week=?2 AND item=?3")
      .bind(k.person, k.week, k.item).first();
    if (!photo) throw new HttpError(404, "no photo for this session");
  }

  const text = await mistral(env, [{
    role: "user",
    content: [
      { type: "text", text: PROMPT },
      { type: "image_url", image_url: `data:${photo.mime};base64,${photo.data}` },
    ],
  }], { json: true, maxTokens: 500 });

  let r;
  try { r = JSON.parse(text.replace(/^```(json)?|```$/g, "").trim()); } catch { throw new HttpError(502, "couldn't read the image"); }
  const km = Number(r.km);
  const hr = Math.round(Number(r.hr));
  return json({
    km: km > 0 && km < 200 ? Math.round(km * 100) / 100 : null,
    duration: pick(r.duration, /^(\d{1,2}:)?\d{1,2}:\d{2}$/),
    pace: pick(r.pace, /^\d{1,2}:\d{2}$/),
    hr: hr >= 40 && hr <= 230 ? hr : null,
    cadence: Number(r.cadence) >= 60 && Number(r.cadence) <= 240 ? Math.round(Number(r.cadence)) : null,
    date: pick(r.date, /^\d{4}-\d{2}-\d{2}$/),
    type: ["run", "swim", "bike", "hike", "gym", "other"].includes(r.type) ? r.type : null,
    title: typeof r.title === "string" && r.title.trim() ? r.title.trim().slice(0, 80) : null,
    extra: cleanExtra(r.extra),
  });
});
