// One suggestion per runner per day, written by Claude at 09:00 from their plan + logged sessions.
//   GET  /api/today?person=&today=   -> { prompt, dataAt, form, numbers, prehab } (null prompt = nothing logged recently)
//        ../../daily.sh -> ../peer_suggest.py runs Claude on the prompt and stores the result in `suggestions`.
//   POST /api/today { person, today } -> { suggestion | null, newer } (read-only; newer = sessions logged since it was written)
// WGW doesn't use this: their suggestion comes from Garmin via ../../daily.sh (public/wgw.json).
import { DATE, HttpError, fromQuery, handle, json, key } from "../../lib/shared.js";
import { planFor } from "../../public/plans.js";
import { DAY, describeWeek, mmss, sec } from "../../lib/week.js";
import { formCheck, formFlags } from "../../lib/form.js";
import { sportsScience } from "../../lib/science.js";
import { coachMetrics, describeMetrics } from "../../lib/metrics.js";

const WINDOW_DAYS = 21;

const shift = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const mondayOf = (d) => shift(d, -((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7));

/** The plan's easy-run target (pace/HR), if it has one. */
function easyTarget(person, week) {
  const it = planFor(person, week).items?.find((i) => /easy/i.test(i.kind) && i.target?.hr);
  return it?.target || null;
}
/** Daniels intensity zone from avg HR as % of max HR seen. */
function zoneOf(hr, maxHr) {
  const f = (hr / maxHr) * 100;
  const z = f < 80 ? "E (easy)" : f < 86 ? "M (steady/marathon)" : f < 93 ? "T (threshold)" : "I (VO2max/race)";
  return `avg HR ${hr} = ${Math.round(f)}% of max seen ${maxHr} → ${z} zone`;
}
function runCheck(a, easy, maxHr) {
  if (a.type !== "run" || !a.hr) return "";
  const zone = maxHr ? zoneOf(a.hr, maxHr) : "";
  if (!easy) return zone;
  const [lo, hi] = easy.hr;
  const out = [];
  if (hi && a.hr > hi) out.push(`avg HR ${a.hr} is ${a.hr - hi} bpm ABOVE the easy ceiling ${hi}`);
  else out.push(`avg HR ${a.hr} is WITHIN easy range ${lo || ""}–${hi}`);
  const pace = a.pace ? sec(a.pace) : a.km && a.duration ? sec(a.duration) / a.km : null;
  if (pace && easy.pace) {
    const fast = sec(easy.pace[0]);
    if (pace < fast) out.push(`pace ${mmss(pace)} is ${Math.round(fast - pace)} s/km faster than easy pace ${easy.pace.join("–")}`);
  }
  return [zone, out.join("; ") + " (fine only if the run was meant to be hard)"].filter(Boolean).join("; ");
}

function describeActivity(a, easy, maxHr) {
  let extra = "";
  try {
    const x = a.extra ? JSON.parse(a.extra) : null;
    if (x) extra = Object.entries(x).map(([k, v]) => `${k} ${v}`).join(", ");
  } catch {}
  const bits = [a.title, a.km && `${a.km} km`, a.duration && `time ${a.duration}`, a.pace && `pace ${a.pace}/km`,
    a.hr && `avg HR ${a.hr}`, a.cadence && `cadence ${a.cadence}`, a.note && `note: "${a.note}"`, extra].filter(Boolean);
  const fc = formCheck(a), rc = runCheck(a, easy, maxHr);
  return `- ${a.date} (${DAY[(new Date(a.date + "T00:00:00Z").getUTCDay() + 6) % 7]}) ${a.type}: ${bits.join(", ")}` +
    (rc ? `\n    HR CHECK: ${rc}` : "") + (fc ? `\n    FORM CHECK: ${fc}` : "");
}

async function build(env, src) {
  const today = DATE.test(src.today || "") ? src.today : new Date().toISOString().slice(0, 10);
  const { person } = key({ person: src.person, week: mondayOf(today) }, { item: false });
  if (person === "WGW") throw new HttpError(400, "WGW's suggestion comes from Garmin");

  const week = mondayOf(today);
  const from = shift(today, -WINDOW_DAYS);
  const yesterday = shift(today, -1);
  const longFrom = shift(today, -365); // a year, so max HR seen isn't lost; VDOT/drift use the last 120 days
  const [acts, logs, cachedRes, prevRes, formRes, longActs, longLogs] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM activities WHERE person=?1 AND date BETWEEN ?2 AND ?3 ORDER BY date").bind(person, from, today),
    env.DB.prepare("SELECT week, item, km, duration, pace, hr, note, updated_at FROM progress WHERE person=?1 AND week BETWEEN ?2 AND ?3")
      .bind(person, mondayOf(from), week),
    env.DB.prepare("SELECT data, data_at, created_at FROM suggestions WHERE person=?1 AND date=?2").bind(person, today),
    env.DB.prepare("SELECT data FROM suggestions WHERE person=?1 AND date=?2").bind(person, yesterday),
    env.DB.prepare("SELECT * FROM activities WHERE person=?1 AND type='run' AND date < ?2 AND date >= ?3 AND extra IS NOT NULL " +
      "ORDER BY date DESC LIMIT 6").bind(person, from, shift(today, -180)),
    env.DB.prepare("SELECT * FROM activities WHERE person=?1 AND date BETWEEN ?2 AND ?3 ORDER BY date").bind(person, longFrom, today),
    env.DB.prepare("SELECT week, item, km, duration, hr, note FROM progress WHERE person=?1 AND week BETWEEN ?2 AND ?3")
      .bind(person, mondayOf(longFrom), week),
  ]);
  const activities = acts.results, rows = logs.results, cached = cachedRes.results[0];
  const dataAt = [...activities, ...rows].map((r) => r.updated_at || "").sort().pop() || null;

  const base = { person, today, cached, dataAt };
  if (!dataAt) return { ...base, prompt: null };

  const todayIdx = (new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7;
  const plan = planFor(person, week);
  const paces = plan.notes?.rows?.map((r) => `${r[2]} ${r[3]} ${r[4]}`).join("; ");
  const weeks = [describeWeek(person, shift(week, -7), rows, null), describeWeek(person, week, rows, todayIdx)];
  if (todayIdx >= 5) weeks.push(`NEXT WEEK: ${describeWeek(person, shift(week, 7), [], 0)}`);
  const dayPlan = (d) => {
    const pl = planFor(person, mondayOf(d));
    if (pl.empty) return "no plan entered";
    const idx = (new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7;
    const its = pl.items.filter((i) => i.dayIndex === idx);
    if (!its.length || its.every((i) => i.rest)) return "REST DAY (nothing planned)";
    return its.filter((i) => !i.rest).map((i) => `${i.kind}: ${i.title}${i.meta ? ` (${i.meta})` : ""}`).join(" + ");
  };
  const tomorrow = shift(today, 1);
  let prev = null;
  try { prev = prevRes.results[0] ? JSON.parse(prevRes.results[0].data) : null; } catch {}
  const prevText = prev ? `${prev.call}: ${prev.headline}${prev.session ? ` — ${prev.session}` : ""}` : "none";
  const older = formRes.results.map((a) => ({ a, fc: formCheck(a) })).filter((r) => r.fc).reverse()
    .map(({ a, fc }) => `- ${a.date}: ${[a.km && `${a.km} km`, a.pace && `${a.pace}/km`].filter(Boolean).join(", ")} → ${fc}`);
  // Coaching numbers over ~120 days: added activities plus ticked plan sessions with details (not double-counted).
  const sessions = [...longActs.results];
  const seen = new Set(sessions.map((a) => `${a.date}|${a.type}`));
  for (const r of longLogs.results) {
    const it = planFor(person, r.week).items?.find((i) => i.id === r.item);
    if (!it || !r.duration) continue;
    const date = shift(r.week, it.dayIndex), type = /strength/i.test(it.kind) ? "gym" : "run";
    if (date > today || seen.has(`${date}|${type}`)) continue;
    sessions.push({ date, type, title: `${it.kind}: ${it.title}`, km: r.km, duration: r.duration, hr: r.hr, note: r.note });
  }
  const goalPace = plan.notes?.rows?.find((r) => r[0] === "G")?.[3];
  const goal5k = goalPace && /^\d+:\d{2}$/.test(goalPace) ? sec(goalPace) * 5 : null;
  const metrics = coachMetrics(sessions, today, goal5k);
  const numbers = describeMetrics(metrics);
  const recentFirst = [...activities].reverse().concat(formRes.results);
  const flags = formFlags(recentFirst);
  const late = activities.some((a) => shift(today, -3) <= a.date && /^(2[2-3]|0[0-3]):/.test((() => {
    try { return JSON.parse(a.extra || "{}").start || ""; } catch { return ""; } })()));
  const science = sportsScience(flags, metrics, late);

  const easy = easyTarget(person, week);
  const describe = (a) => describeActivity(a, easy, metrics.maxHr);
  // Test pacing from data: best recent run of roughly race distance (4.5-6 km), so the model can't fall back on goal pace.
  let testLine = "";
  if (/time trial|test|race/i.test(dayPlan(today) + " " + dayPlan(tomorrow))) {
    const best = [...activities, ...formRes.results]
      .filter((a) => a.type === "run" && a.km >= 4.5 && a.km <= 6 && a.duration)
      .map((a) => ({ a, p: sec(a.duration) / a.km })).sort((x, y) => x.p - y.p)[0];
    if (best) {
      const p = best.p;
      testLine = `TEST PACING (computed, use this, not goal pace): best recent ~5K is ${best.a.duration} for ${best.a.km} km ` +
        `(${mmss(p)}/km) on ${best.a.date}. Start at ${mmss(p)}–${mmss(p + 5)}/km for 2-3 km, then push if it feels controlled; ` +
        `a realistic test result is about ${mmss(Math.max(p - 10, 0))}–${mmss(p)}/km.\n`;
    }
  }
  const doneYesterday = activities.filter((a) => a.date === yesterday).map(describe);

  const prompt = `You are a careful running coach writing TODAY's suggestion for an amateur runner (${person}).
Today is ${today} (${DAY[todayIdx]}).${paces ? `\nTheir target paces: ${paces}.` : ""}
TODAY'S PLAN (${DAY[todayIdx]}): ${dayPlan(today)}
TOMORROW'S PLAN (${DAY[(todayIdx + 1) % 7]}): ${dayPlan(tomorrow)}
${testLine}
PLAN (last week, this week${todayIdx >= 5 ? ", next week" : ""}). "upcoming" = not yet due; "NOT done" = missed:
${weeks.join("\n\n")}

SESSIONS THEY LOGGED THEMSELVES (last ${WINDOW_DAYS} days, may include off-plan runs):
${activities.length ? activities.map(describe).join("\n") : "(none)"}

${older.length ? `EARLIER RUNS, FORM ONLY (before the window, for the trend):\n${older.join("\n")}\n\n` : ""}FORM CHECK lines are computed from Garmin's running-dynamics bands and are correct; don't re-judge the numbers.
If a metric is AVERAGE-but-near-the-limit, HIGH/LONG/LOW or UNEVEN across several runs, put ONE specific, practical
cue for it into "session" or "why" (e.g. high vertical ratio or low cadence: aim ~5% higher cadence, shorter quicker
steps, "run quiet", a few strides; long ground contact: quick feet, slight forward lean; uneven balance: note it,
mention it only if it persists). Tie the cue to today's session, or on a rest day put it in "next" for tomorrow's run. Don't list every metric.

COACH NUMBERS (computed from their logs with standard methods; correct; base the advice on them):
${numbers.prompt}

${science.prompt}

Use these like a qualified coach and sports-rehab specialist would:
- Explain the mechanism behind today's advice in plain words (which tissue/joint/system, and why), in "science".
- Refer to the prehab routine when it fits the day (rest day, easy day); never pile it before a test or quality run.
- Easy runs: current-fitness E pace and the easy HR ceiling, never the plan's goal-based easy pace if it is faster.
- Quality runs: current T/I paces; say when a plan pace is beyond current fitness and what to run instead.
- If easy share is well under 80%, the main fix is slowing the easy runs down; say it with the numbers.
- Cite the number and the principle in a few words ("VDOT 34.7 → E 6:50–7:30", "40% easy vs the 80/20 guide").
Judge how hard a PAST run was by its HR zone in the HR CHECK line, never by comparing its pace with the paces above
(those paces may be derived from that very run).
HR CHECK and FORM CHECK lines are computed and correct. If easy runs keep landing ABOVE the easy HR ceiling, say so
plainly and give the fix as numbers (e.g. "slow to ~7:00/km so HR stays ≤150").

Decide today's call:
- "planned": today has a planned session and the recent load supports it (say exactly what, with the plan's targets).
- "easy": a planned hard day should be softened (e.g. hard efforts on back-to-back days, very high avg HR on easy runs,
  late-night runs cutting sleep), or nothing is planned but an easy run fits. Give a pace or HR cap.
- "rest": today is a rest day, or the last 1-2 days were hard/long enough that rest is wiser.
- "quality": only if the plan calls for intensity today and recent sessions were easy.
- "gym" / "cross": strength or cross-training is the better choice today.
Use the numbers in the data. Easy runs with avg HR well above ~150, or long runs paced like tempo, are worth naming.
A session logged on the same day as a planned one is probably that session done (or swapped).
Planned sessions are targets, not things that happened: only the logged sessions above happened. Refer to days
by date when it matters: "Saturday" this week (upcoming) is not the Saturday that has passed.
Time trials / tests measure current fitness: pace them from the runner's recent logged efforts (best recent 5K-ish
pace, then a strong finish), never from the plan's goal pace. A goal pace well beyond recent results is a target for
the end of the plan, not for the test.
Non-running activities (table tennis, other sports, walks) count as light-to-moderate load by their HR and duration.
Quote distances, paces and HR exactly as logged; never take them from the plan for a past session.
If today is a rest day in the plan, the call is "rest" unless there is a clear reason otherwise.
The "next" field is about TOMORROW'S PLAN as given above.
No medical claims.

YESTERDAY (${yesterday}, ${DAY[(todayIdx + 6) % 7]}):
- Plan: ${dayPlan(yesterday)}
- Your suggestion for it: ${prevText}
- Logged that day: ${doneYesterday.length ? "\n  " + doneYesterday.join("\n  ") : "nothing added (check the plan above for ticked sessions)"}
In "yesterday", comment in 1-2 short sentences on how yesterday went against your suggestion (or the plan if there
was no suggestion): followed, swapped, overdone, skipped? Use the logged numbers. If nothing was planned, suggested
or logged yesterday, use null.

STYLE. Write like a sharp coach texting the runner, not a report:
- Short, direct sentences. Numbers over adjectives. Name the runner's actual problem.
- No filler: never "critical", "ensure", "optimal", "maximize", "prioritize", "aligns with", "it's important to".
- Don't restate the plan or the data back at them; say what to DO and the one reason.
- Good: "HR high, cadence low. Easy runs at ~7:00/km, HR ≤150, cadence up to ~165." Bad: "Today's rest ensures
  optimal freshness for tomorrow's critical test, which aligns with the plan."

Reply with ONLY one JSON object:
{"call": "rest"|"easy"|"planned"|"quality"|"gym"|"cross",
 "headline": "<max 50 chars, the decision>",
 "session": "<max 120 chars, exactly what to do (distance/time, pace, HR, cadence cue), or null on rest>",
 "why": "<max 200 chars, the one or two reasons from the data>",
 "next": "<max 140 chars, tomorrow, with its key target>",
 "yesterday": "<max 160 chars, how yesterday went vs the suggestion/plan, no advice, or null>",
 "science": "<max 260 chars, the physiology/biomechanics behind today's advice: name the tissue or system and the mechanism>"}`;

  return { ...base, prompt, form: flags?.text || null, numbers: numbers.card, prehab: science.prehab };
}

export const onRequestGet = handle(async ({ request, env }) => {
  const b = await build(env, fromQuery(request));
  return json({ person: b.person, today: b.today, dataAt: b.dataAt, prompt: b.prompt, form: b.form || null, numbers: b.numbers || null, prehab: b.prehab || [] });
});

export const onRequestPost = handle(async ({ request, env }) => {
  const body = await request.json().catch(() => ({}));
  const today = DATE.test(body.today || "") ? body.today : new Date().toISOString().slice(0, 10);
  const { person } = key({ person: body.person, week: mondayOf(today) }, { item: false });
  const [row, latest] = await env.DB.batch([
    env.DB.prepare("SELECT data, data_at FROM suggestions WHERE person=?1 AND date=?2").bind(person, today),
    env.DB.prepare("SELECT max(u) AS m FROM (SELECT updated_at AS u FROM activities WHERE person=?1 " +
      "UNION ALL SELECT updated_at FROM progress WHERE person=?1)").bind(person),
  ]);
  const r = row.results[0], m = latest.results[0]?.m || "";
  return json({ suggestion: r ? JSON.parse(r.data) : null, newer: !!(r && m > (r.data_at || "")) });
});
