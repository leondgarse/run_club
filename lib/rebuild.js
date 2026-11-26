// Plan rebuild: Claude rewrites the rest of a runner's plan around their own data; the runner accepts it in the app.
// Code sets the limits and checks the draft (CLAUDE.md: numbers are computed here, the model only arranges them):
//   - paces from their fitness (VDOT floor → T/I/R/M; easy pace from their own HR, lib/metrics.js)
//   - a realistic 5K at the end of the plan (current VDOT + a beginner's typical gain over the weeks left)
//   - weekly km: from what they ran in the last weeks, at most ~10% more per week
//   - their usual run days
// A draft that breaks a limit is refused with the reason (scripts/plan_rebuild.py gives it back to Claude once).
import { coachMetrics, predict, trainingPaces, vdot } from "./metrics.js";
import { CHANGE_KINDS, planFor, splitChange } from "../public/plans.js";
import { RULES, untrusted } from "./rules.js";
import { mmss, sec, sessionKm } from "./week.js";

const shift = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const dIdx = (d) => (new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7;
const mondayOf = (d) => shift(d, -dIdx(d));
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hms = (s) => mmss(Math.round(s));

/** Activities + ticked plan sessions with details (each session once), last year. */
async function loadSessions(env, person, today) {
  const from = shift(today, -365);
  const [acts, logs, goalR, chR] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM activities WHERE person=?1 AND date BETWEEN ?2 AND ?3 ORDER BY date").bind(person, from, today),
    env.DB.prepare("SELECT week, item, km, duration, hr, note FROM progress WHERE person=?1 AND week >= ?2").bind(person, mondayOf(from)),
    env.DB.prepare("SELECT text, date, max_hr, rest_hr FROM goals WHERE person=?1").bind(person),
    env.DB.prepare("SELECT week, data FROM plan_changes WHERE person=?1").bind(person),
  ]);
  const changes = {};
  for (const c of chR.results) try { changes[`${person}|${c.week}`] = JSON.parse(c.data); } catch {}
  const sessions = [...acts.results];
  const seen = new Set(sessions.map((a) => `${a.date}|${a.type}`));
  const linked = new Set(sessions.filter((a) => a.week).map((a) => `${a.week}|${a.item}`));
  for (const r of logs.results) {
    const it = planFor(person, r.week, changes).items?.find((i) => i.id === r.item);
    if (!it || !r.duration) continue;
    const date = shift(r.week, it.dayIndex), type = /strength/i.test(it.kind) ? "gym" : "run";
    if (date > today || seen.has(`${date}|${type}`) || linked.has(`${r.week}|${r.item}`)) continue;
    sessions.push({ date, type, title: `${it.kind}: ${it.title}`, km: r.km, duration: r.duration, hr: r.hr, note: r.note });
  }
  sessions.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { sessions, goal: goalR.results[0] || null, changes };
}

/** The last week the runner's plan has (TJH: week 8), searching up to 16 weeks ahead. */
function planEnd(person, from) {
  let last = null;
  for (let w = mondayOf(from), i = 0; i < 16; i++, w = shift(w, 7)) if (!planFor(person, w).empty) last = w;
  return last ? shift(last, 6) : null;
}

/** Everything the prompt and the check need. */
export async function rebuildContext(env, person, today) {
  const { sessions, goal, changes } = await loadSessions(env, person, today);
  const m = coachMetrics(sessions, today, null, goal || {});
  if (!m.vdot) throw new Error("not enough runs to rebuild from");
  const start = shift(mondayOf(today), 7), end = planEnd(person, start);
  if (!end || end < start) throw new Error("no plan weeks left to rebuild");
  const weeks = Math.round((Date.parse(end) - Date.parse(start)) / 864e5 + 1) / 7;
  // Fitness for the paces: the VDOT from their best actual run. (Their HR on easy runs can suggest more, but HR alone
  // flatters, e.g. a high max-HR reading; quality paces must come from what they have actually run.)
  // Easy from their HR, never faster than M + 10 s.
  const V = m.vdot;
  const p = trainingPaces(V), floorE = sec(p.M) + 10;
  const eFast = m.hrEasy ? Math.max(sec(m.hrEasy.fast), floorE) : sec(p.E[0]);
  const eSlow = Math.max(m.hrEasy ? sec(m.hrEasy.slow) : sec(p.E[1]), eFast + 30);
  const paces = { E: [mmss(eFast), mmss(eSlow)], M: p.M, T: p.T, I: p.I, R: p.R, V: Math.round(V * 10) / 10 };
  // A realistic finish: newer runners gain roughly 0.4–0.8 VDOT a week for the first months (capped).
  const lo = V + Math.min(weeks * 0.4, 4), hi = V + Math.min(weeks * 0.8, 6);
  const goalRange = [Math.round(predict(hi, 5000)), Math.round(predict(lo, 5000))]; // fast, slow (seconds)
  // Run days they actually use (last 6 weeks).
  const counts = DAYS.map(() => 0);
  for (const a of sessions) if (a.type === "run" && a.date > shift(today, -42) && a.date <= today) counts[dIdx(a.date)]++;
  // Their latest pattern matters most: run days this week and last week (by date).
  const runDays = (w) => [...new Set(sessions.filter((a) => a.type === "run" && a.date >= w && a.date <= shift(w, 6) && a.date <= today)
    .map((a) => dIdx(a.date)))].sort().map((i) => DAYS[i]);
  const thisMon = mondayOf(today), latest = [[thisMon, runDays(thisMon)], [shift(thisMon, -7), runDays(shift(thisMon, -7))]];
  const weekKm = m.weekKm || [];
  return { person, today, start, end, weeks, m, paces, goalRange, counts, latest, weekKm, goal, sessions, changes,
    kmCap: Math.max(...weekKm, 10) };
}

const PACE_RE = /(\d{1,2}):(\d{2})\s*\/\s*km/g; // explicit paces must be written "m:ss/km"


/**
 * Checks a draft against the limits; returns the proposal to store, or throws with a reason Claude can act on.
 * draft: { why, goal_5k: "m:ss", weeks: [{ week, focus }], sessions: [{ date, kind, title, meta }] }
 */
export function checkRebuild(draft, ctx) {
  const why = String(draft?.why || "").trim();
  const g = sec(String(draft?.goal_5k || ""));
  if (!(g > 0)) throw new Error("goal_5k missing (m:ss)");
  if (g < ctx.goalRange[0] - 15 || g > ctx.goalRange[1] + 30) {
    throw new Error(`goal_5k ${hms(g)} is outside the realistic range ${hms(ctx.goalRange[0])}–${hms(ctx.goalRange[1])}`);
  }
  const G = mmss(g / 5);
  const sessions = Array.isArray(draft?.sessions) ? draft.sessions : [];
  if (sessions.length < ctx.weeks * 2) throw new Error("too few sessions: at least 2 runs a week");
  // Pace limits per kind (8 s/km of slack: the VDOT is a floor).
  const fast = { Easy: sec(ctx.paces.E[0]), Long: sec(ctx.paces.E[0]), "Long · Easy": sec(ctx.paces.E[0]), Tempo: sec(ctx.paces.T),
    Threshold: sec(ctx.paces.T), Interval: sec(ctx.paces.I), Repetition: sec(ctx.paces.R), "Goal pace": g / 5 };
  for (const x of sessions) {
    if (!CHANGE_KINDS.includes(x?.kind)) throw new Error(`kind "${x?.kind}" isn't allowed`);
    if (x.date < ctx.start || x.date > ctx.end) throw new Error(`${x.date} is outside ${ctx.start}–${ctx.end}`);
    const lim = fast[x.kind];
    if (lim) for (const r of `${x.title} ${x.meta || ""}`.matchAll(PACE_RE)) {
      const s = +r[1] * 60 + +r[2];
      if (s < lim - 8) throw new Error(`${x.date} ${x.kind} "${x.title}": ${r[1]}:${r[2]}/km is faster than their ${x.kind} pace ${mmss(lim)}/km`);
    }
  }
  // Weekly km: from the most they ran in a recent week, ≤ ~10% more each week (a little slack for rounding).
  let prev = ctx.kmCap;
  for (let w = ctx.start; w <= ctx.end; w = shift(w, 7)) {
    const km = sessions.filter((x) => x.date >= w && x.date <= shift(w, 6) && !/strength|cross|rest/i.test(x.kind)).reduce((a, x) => a + sessionKm(x), 0);
    if (km > prev * 1.12 + 1.5) throw new Error(`week of ${w}: ~${Math.round(km)} km is more than 10% above ${Math.round(prev)} km`);
    if (km > 0) prev = Math.max(km, prev * 0.7);
  }
  const focus = Object.fromEntries((draft.weeks || []).filter((w) => w?.week && w.focus).map((w) => [w.week, String(w.focus).slice(0, 120)]));
  const proposal = {
    rebuild: true, start: ctx.start, end: ctx.end, why, focus, goal5k: hms(g),
    paces: { E: `${ctx.paces.E[0]}–${ctx.paces.E[1]}`, M: ctx.paces.M, T: ctx.paces.T, I: ctx.paces.I, R: ctx.paces.R, G },
    easyCeil: ctx.m.easyCeil,
    sessions: sessions.map((x) => ({ date: x.date, kind: x.kind, title: x.title, meta: x.meta || "" })),
  };
  splitChange(proposal, ctx.today, 70); // the same validation Accept will run (text rules, dates)
  return proposal;
}

export function rebuildPrompt(ctx) {
  const { m, paces, goalRange, counts, weekKm, goal } = ctx;
  const recent = ctx.sessions.filter((a) => a.date > shift(ctx.today, -28)).map((a) => {
    const pace = a.km && a.duration ? `${mmss(sec(a.duration) / a.km)}/km` : "";
    return `- ${a.date} (${DAYS[dIdx(a.date)]}) ${a.type}: ${[a.title && untrusted(a.title, 40), a.km && `${a.km} km`, a.duration, pace, a.hr && `HR ${a.hr}`].filter(Boolean).join(", ")}`;
  });
  const template = [];
  for (let w = ctx.start; w <= ctx.end; w = shift(w, 7)) {
    const pl = planFor(ctx.person, w);
    template.push(`  ${w} ${pl.title}: ${(pl.items || []).filter((i) => !i.rest).map((i) => `${i.day} ${i.kind}: ${i.title}`).join("; ")}`);
  }
  return `You are a careful running coach rebuilding the rest of an amateur runner's 5K plan (${ctx.person}) so it fits THEM,
not a template. Today is ${ctx.today}. Write the plan from ${ctx.start} (Mon) to ${ctx.end} (Sun), ${ctx.weeks} weeks.

THEIR TARGET (quoted, data): ${goal?.text ? untrusted(goal.text, 80) : "none set"}
THEIR NUMBERS (computed from their logs; correct, use them):
- Fitness: VDOT ${m.vdotKind === "all-out" ? "" : "at least "}${m.vdot} from their best run → 5K about ${m.pred5k}${m.vdotKind === "all-out" ? "" : " or faster"};
  paces below use VDOT ${paces.V}${paces.V > m.vdot ? " (their heart rate on easy runs shows more fitness than that run)" : ""}.
- Training paces now (use these, never faster): easy ${paces.E[0]}–${paces.E[1]}/km (HR ≤ ${m.easyCeil}), M ${paces.M}, T ${paces.T}, I ${paces.I}, R ${paces.R} /km.
- Realistic 5K at the end of these ${ctx.weeks} weeks: ${hms(goalRange[0])}–${hms(goalRange[1])}. Pick "goal_5k" in that range; G (goal pace) = goal_5k ÷ 5.
  If their own target is faster than that, it is a longer-term aim: say so kindly in "why", with the realistic step for now.
- Run km per week, last 4 weeks: ${weekKm.join(" → ")}. Easy share (28 d): ${m.easyShare ?? "?"}%.
- Days they ran: week of ${ctx.latest[0][0]} (this week): ${ctx.latest[0][1].join(", ") || "none"}; week of ${ctx.latest[1][0]}: ${ctx.latest[1][1].join(", ") || "none"}.
  Over the last 6 weeks: ${DAYS.map((d, i) => `${d} ${counts[i]}`).join(", ")}. Their most recent week is their current routine: use those days.

THEIR LAST 4 WEEKS:
${recent.join("\n") || "(none)"}

THE CURRENT (TEMPLATE) WEEKS, for structure only; its paces were set for someone else:
${template.join("\n")}

BUILD RULES:
- Put runs on the days of their most recent week (above); 4 runs a week if they run 4+ days, else 3. The long run on
  the last run day of their week; no hard session the day before the long run; strength on non-run days.
- Weekly run km, counted like this: every "N km" in the titles, reps as their total ("6×800 m" = 4.8 km), plus 3 km of
  warm-up/cool-down for each session with reps. Week 1 (${ctx.start}) at most ${Math.floor(ctx.kmCap * 1.1)} km; after that each week
  at most 10% more than the week before; every 3rd or 4th week lighter (−20–30%). Stay a little under the limits.
  The last week tapers and ends with a 5K test/race (kind "Test" or "Race") on Sat or Sun.
- 80/20: about one quality run a week early on (strides, then T, then I), two at most later; the rest easy.
  Long run ≤ about 30% of the week. Easy runs: give an HR cap (≤ ${m.easyCeil}) in "meta".
- Write paces as letters ("@ T", "6×800 m @ I", "E 6 km") or explicitly as "m:ss/km". Never faster than the paces above.
- Add Strength twice a week (15 min, kind "Strength") on an easy or rest day if it fits.
- Distances in km in the title ("E 6 km + 4 strides", "Long 10 km easy", "5×1 km @ I"), so the weekly km can be checked.
- "weeks": one short focus per week (max 100 chars), e.g. "Base: easy volume + strides".
- Kinds: ${CHANGE_KINDS.join(", ")}. Titles max 50 chars, meta max 40, English workout notation.

${RULES}

Reply with ONLY one JSON object:
{"why": "<max 200 chars: what's different from the template and why>", "goal_5k": "m:ss",
 "weeks": [{"week": "YYYY-MM-DD (Monday)", "focus": "..."}],
 "sessions": [{"date": "YYYY-MM-DD", "kind": "...", "title": "...", "meta": "..."}]}`;
}
