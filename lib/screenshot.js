// Workout screenshot → activity fields. Split in two so it survives different apps and different crops:
//   1. Mistral vision only TRANSCRIBES what is printed: label/value pairs, the title, the date text, a split table.
//   2. This file MAPS labels to fields with an EN/中文 glossary, converts units, then cross-checks the numbers
//      (distance × pace ≈ time, cadence × stride ≈ speed, split count ≈ distance). Unknown labels are ignored and
//      inconsistent values are dropped, so a calorie number can't land in "training load".
// Tested on Huawei Health (EN) and OPPO Health (中文) summaries; other apps work to the extent their labels match.

export const PROMPT = `Transcribe this workout-summary screenshot. Do NOT interpret or calculate; copy what is printed.
The screenshot may be cropped anywhere. Reply with JSON only:
{
 "title": the header / activity name exactly as printed (e.g. "12.5 km steady long run", "户外跑步"), or null,
 "datetime": the date/time text exactly as printed (e.g. "11/14/26, 10:23 PM", "2026-07-28 18:10"), or null,
 "distance": {"value": "...", "unit": "..."} for the big headline distance, or null,
 "pairs": [ {"label": "...", "value": "...", "unit": "..."} ]   one per metric tile, label in its original language,
          value as printed (keep ' and " in paces, keep "51.5%/48.5%" or "49.9% Left 50.1% Right" whole),
 "splits": [ {"km": "...", "pace": "...", "hr": "..."} ]   ONLY rows of a per-km split table, else []
}
Rules: a "Slowest/Fastest" bar is not a split table. Skip icons. Use null/[] for anything not visible. Never guess.`;

// label regex → field. Checked in order; first match wins. Labels are lower-cased, spaces collapsed.
const GLOSSARY = [
  ["max_hr",        /max(imum)?\s*heart\s*rate|最高心率|最大心率/],
  ["hr",            /(avg|average)\s*heart\s*rate|^heart\s*rate$|平均心率/],
  ["duration",      /^(duration|time|total time|moving time|elapsed time)$|时长|用时|运动时间|总时间/],
  ["pace",          /(avg|average)\s*pace|^pace$|平均配速/],
  ["cadence",       /(avg|average)\s*cadence|^cadence$|平均步频|步频/],
  ["stride",        /(avg|average)\s*stride|stride length|平均步幅|步幅/],
  ["lr_balance",    /balance|触地平衡|左右平衡/],
  ["gct_ms",        /ground\s*contact|触地时间/],
  ["vert_osc_cm",   /vertical\s*oscillation|垂直振幅/],
  ["power_w",       /(avg|average)\s*power|^power$|平均功率/],
  ["elev_m",        /elevation\s*gain|total\s*ascent|累计爬升|爬升/],
  ["training_load", /training\s*load|训练负荷/],
  ["distance",      /^distance$|^距离$/],
];

const num = (s) => { const m = String(s ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : NaN; };
const pad = (n) => String(n).padStart(2, "0");
/** "5'41\"" / "5:41" / "5′41″" → seconds */
function paceSec(v) {
  const m = String(v ?? "").match(/(\d{1,2})\s*['′:分]\s*(\d{1,2})/);
  return m && +m[2] < 60 ? +m[1] * 60 + +m[2] : NaN;
}
/** "01:11:15" / "27:19" → seconds */
function durSec(v) {
  const p = String(v ?? "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!p) return NaN;
  return p[3] != null ? +p[1] * 3600 + +p[2] * 60 + +p[3] : +p[1] * 60 + +p[2];
}
const fmtDur = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`);
const fmtPace = (s) => `${Math.floor(s / 60)}:${pad(Math.round(s % 60))}`;
const within = (a, b, tol) => Math.abs(a - b) / b <= tol;

/** Date/time text → {date, start}. Handles M/D/YY(YY) with AM/PM, YYYY-MM-DD HH:MM, YYYY/MM/DD, M月D日. */
export function parseDateTime(text, today) {
  const t = String(text || "");
  let y, mo, d;
  let m = t.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) [mo, d, y] = [+m[1], +m[2], +m[3] < 100 ? 2000 + +m[3] : +m[3]];
  else if ((m = t.match(/(\d{1,2})月(\d{1,2})日/))) [y, mo, d] = [+today.slice(0, 4), +m[1], +m[2]];
  let date = null;
  if (y && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
    date = `${y}-${pad(mo)}-${pad(d)}`;
    if (date > today) date = null; // a future date is a misread
  }
  let start = null;
  const tm = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM|上午|下午)?/i);
  if (tm) {
    let h = +tm[1];
    const ap = (tm[3] || "").toUpperCase();
    if ((ap === "PM" || ap === "下午") && h < 12) h += 12;
    if ((ap === "AM" || ap === "上午") && h === 12) h = 0;
    if (h < 24 && +tm[2] < 60) start = `${pad(h)}:${tm[2]}`;
  }
  return { date, start };
}

function typeOf(title) {
  const t = String(title || "").toLowerCase();
  if (/swim|游泳/.test(t)) return "swim";
  if (/ride|cycl|bike|骑行|单车/.test(t)) return "bike";
  if (/hike|walk|徒步|步行|健走/.test(t)) return "hike";
  if (/strength|gym|力量|健身/.test(t)) return "gym";
  if (/run|jog|跑/.test(t)) return "run";
  return null;
}

/** Model transcription → { km, duration, pace, hr, cadence, date, type, title, extra, notes[] } */
export function mapTranscription(r, today) {
  const out = { km: null, duration: null, pace: null, hr: null, cadence: null, date: null, type: null, title: null, extra: {}, notes: [] };
  const x = out.extra;
  const pairs = Array.isArray(r?.pairs) ? r.pairs : [];
  const got = {};
  for (const p of pairs) {
    const label = String(p?.label || "").toLowerCase().replace(/\s+/g, " ").trim();
    const hit = GLOSSARY.find(([, re]) => re.test(label));
    if (hit && got[hit[0]] == null) got[hit[0]] = { value: String(p.value ?? ""), unit: String(p.unit ?? "").toLowerCase() };
  }

  // distance: headline first, else a "Distance" tile
  const dist = r?.distance?.value != null ? { value: r.distance.value, unit: String(r.distance.unit || "").toLowerCase() } : got.distance;
  if (dist) {
    let km = num(dist.value);
    if (/mi|英里/.test(dist.unit) && !/min/.test(dist.unit)) km *= 1.609344;
    else if (/^m$|^米$|meter/.test(dist.unit)) km /= 1000;
    if (km > 0 && km < 300) out.km = Math.round(km * 100) / 100;
  }
  const dur = got.duration ? durSec(got.duration.value) : NaN;
  if (dur > 0) out.duration = fmtDur(dur);
  const pace = got.pace ? paceSec(got.pace.value) : NaN;
  if (pace >= 150 && pace <= 1200) out.pace = fmtPace(pace);
  const n = (k, lo, hi) => { const v = got[k] ? num(got[k].value) : NaN; return v >= lo && v <= hi ? v : null; };
  out.hr = n("hr", 40, 230);
  out.cadence = n("cadence", 60, 240);
  const maxHr = n("max_hr", 60, 230); if (maxHr) x.max_hr = maxHr;
  if (got.stride) {
    let s = num(got.stride.value);
    if (/cm|厘米/.test(got.stride.unit) || s > 30) s /= 100; // cm → m
    if (s >= 0.3 && s <= 2.5) x.stride_m = Math.round(s * 100) / 100;
  }
  if (got.lr_balance) { // "51.5%/48.5%" or "49.9% Left 50.1% Right": the left side's share
    const v = got.lr_balance.value;
    const left = v.match(/(\d{2}(?:\.\d)?)\s*%?\s*(left|左)/i) || v.match(/(?:left|左)\s*(\d{2}(?:\.\d)?)/i) || v.match(/(\d{2}(?:\.\d)?)\s*%?\s*\//);
    const l = left ? +left[1] : NaN;
    if (l >= 40 && l <= 60) x.lr_balance = l;
  }
  const g = n("gct_ms", 120, 450); if (g) x.gct_ms = g;
  if (got.vert_osc_cm) {
    let v = num(got.vert_osc_cm.value);
    if (/mm|毫米/.test(got.vert_osc_cm.unit)) v /= 10;
    if (v >= 2 && v <= 20) x.vert_osc_cm = Math.round(v * 10) / 10;
  }
  const pw = n("power_w", 30, 900); if (pw) x.power_w = pw;
  const el = n("elev_m", 0, 5000); if (el != null) x.elev_m = el;
  const tl = n("training_load", 0, 1000); if (tl != null) x.training_load = tl;

  const title = typeof r?.title === "string" ? r.title.normalize("NFKC").replace(/\s+/g, " ").trim() : "";
  if (title) out.title = title.replace(/[^\p{L}\p{N} .,:;'’()+\-–—/×%°·~&!?、，。：；（）]/gu, "").slice(0, 40) || null;
  out.type = typeOf(title) || (out.km ? "run" : null);
  const dt = parseDateTime(r?.datetime, today);
  out.date = dt.date;
  if (dt.start) x.start = dt.start;

  // Split table: keep only if it looks like one row per km for this distance.
  const rows = (Array.isArray(r?.splits) ? r.splits : []).map((s) => ({ p: paceSec(s?.pace), h: num(s?.hr) }))
    .filter((s) => s.p >= 150 && s.p <= 1800);
  if (rows.length >= 2 && (!out.km || (rows.length >= Math.floor(out.km) - 1 && rows.length <= Math.ceil(out.km) + 1))) {
    x.splits = rows.map((s) => fmtPace(s.p)).join(" ");
    if (rows.every((s) => s.h >= 40 && s.h <= 230)) x.split_hr = rows.map((s) => Math.round(s.h)).join(" ");
  }

  // Cross-checks: drop the value that doesn't fit rather than fill in something wrong.
  if (out.km && dur && pace && !within(out.km * pace, dur, 0.08)) {
    out.notes.push("pace doesn't match distance and time; pace left empty");
    out.pace = null;
  }
  if (out.km && dur && out.cadence && x.stride_m && !within(out.cadence * x.stride_m, (out.km * 1000) / (dur / 60), 0.12)) {
    out.notes.push("cadence × stride doesn't match the speed; stride left empty");
    delete x.stride_m;
  }
  if (!out.date) out.notes.push("no date in the image");
  return out;
}
