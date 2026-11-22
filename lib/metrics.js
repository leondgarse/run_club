// Coaching numbers computed from a runner's logged sessions, so the model reasons from them instead of guessing.
//   - VDOT (Jack Daniels' running formula) from the best recent effort, and the training paces it implies.
//   - HR: max HR (the runner's own from a race/test, else the highest seen) → easy ceiling: Daniels' E-zone top,
//     ~79% of max, or 74% of heart-rate reserve when a resting HR is given (same zone, individualised).
//   - Load: HR-weighted minutes (Edwards-style zone factor from avg HR), 7-day vs 28-day average (ACWR).
//   - Intensity distribution: share of run time at easy HR (polarized / 80-20 guideline).
//   - Aerobic decoupling: efficiency (speed ÷ HR) first half vs second half of a run with per-km splits and HR.
import { mmss, sec } from "./week.js";
import { hrZone } from "../public/charts.js";

// Daniels/Gilbert: VO2 cost of running at v m/min, and the fraction of VO2max sustainable for t minutes.
const vo2 = (v) => -4.6 + 0.182258 * v + 0.000104 * v * v;
const pctMax = (t) => 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
export const vdot = (meters, seconds) => { const t = seconds / 60; return vo2(meters / t) / pctMax(t); };
const velAt = (o2) => (-0.182258 + Math.sqrt(0.182258 ** 2 + 4 * 0.000104 * (o2 + 4.6))) / (2 * 0.000104);
const paceAt = (V, f) => mmss((1000 / velAt(V * f)) * 60);
/** Daniels training paces (min/km) for a VDOT: E 62-70%, M 80%, T 88%, I 97.5%, R 105% of VO2max. */
export const trainingPaces = (V) => ({ E: [paceAt(V, 0.7), paceAt(V, 0.62)], M: paceAt(V, 0.8), T: paceAt(V, 0.88), I: paceAt(V, 0.975), R: paceAt(V, 1.05) });
/** Predicted time (s) for a distance at a VDOT (bisection on the formula). */
export function predict(V, meters) {
  let lo = 60, hi = 6 * 3600;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; vdot(meters, mid) > V ? (lo = mid) : (hi = mid); }
  return (lo + hi) / 2;
}
const hms = (s) => { s = Math.round(s); const h = Math.floor(s / 3600); return h ? `${h}:${mmss(s % 3600).padStart(5, "0")}` : mmss(s); };

const parseX = (a) => { try { return a.extra ? JSON.parse(a.extra) : {}; } catch { return {}; } };
const nums = (s) => String(s || "").split(/[\s,]+/).map(Number).filter((n) => n > 0);
const paceList = (s) => String(s || "").split(/[\s,]+/).filter((t) => /^\d{1,2}:\d{2}$/.test(t)).map(sec);
const shift = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

function decoupling(a) {
  const x = parseX(a), p = paceList(x.splits), h = nums(x.split_hr);
  const n = Math.min(p.length, h.length);
  if (n < 4) return null;
  const half = Math.floor(n / 2);
  const eff = (i, j) => { let s = 0, hr = 0; for (let k = i; k < j; k++) { s += 1000 / p[k]; hr += h[k]; } return s / hr; };
  const e1 = eff(0, half), e2 = eff(n - half, n);
  return Math.round(((e1 - e2) / e1) * 1000) / 10; // % efficiency lost in the second half
}

/**
 * @param sessions [{date, type, title, km, duration, hr, extra}] newest or oldest first, last ~120 days
 * @param today "YYYY-MM-DD"
 * @param goal5k optional goal 5K time in seconds (from the plan)
 * @param hr     optional { max_hr, rest_hr } the runner entered (profile, next to the target)
 */
export function coachMetrics(sessions, today, goal5k = null, hr = {}) {
  const runs = sessions.filter((a) => a.type === "run");
  // Max HR and the easy ceiling (public/charts.js, shared with the charts on the site).
  const { maxHr, seenMax, maxFrom, restHr, easyCeil } = hrZone(runs, hr);

  // VDOT: best all-out effort (avg HR ≥ 88% of max seen, or a test/race) vs best of any run (a floor).
  let race = null, floor = null;
  for (const a of runs) {
    if (!(a.km >= 3 && a.duration) || days(a.date, today) > 120) continue;
    if (/walk|走/i.test(`${a.title || ""} ${a.note || ""}`)) continue; // run/walk times aren't a fitness measure
    const V = vdot(a.km * 1000, sec(a.duration));
    if (!(V > 15 && V < 85)) continue;
    const allOut = /\b(test|race|time trial|TT)\b|比赛|测试/i.test(`${a.title || ""} ${a.note || ""}`) || (maxHr && a.hr && a.hr / maxHr >= 0.88);
    const r = { V, a, effort: a.hr && maxHr ? Math.round((a.hr / maxHr) * 100) : null };
    if (allOut && (!race || V > race.V)) race = r;
    if (!floor || V > floor.V) floor = r;
  }
  const basis = race && (!floor || race.V >= floor.V - 0.5) ? { ...race, kind: "all-out" } : floor ? { ...floor, kind: "floor" } : null;

  // Load: minutes × zone factor from avg HR (1 <60%, 2 <70%, 3 <80%, 4 <90%, 5 ≥90% of max seen).
  const factor = (a) => {
    if (a.hr && maxHr) { const f = a.hr / maxHr; return f < 0.6 ? 1 : f < 0.7 ? 2 : f < 0.8 ? 3 : f < 0.9 ? 4 : 5; }
    if (a.type !== "run") return 2;
    const pace = a.km && a.duration ? sec(a.duration) / a.km : null;
    return pace && pace > 480 ? 2 : 3; // no HR: slower than 8:00/km is run/walk territory
  };
  const load = (from, to) => sessions.filter((a) => a.date > from && a.date <= to && a.duration)
    .reduce((s, a) => s + (sec(a.duration) / 60) * factor(a), 0);
  const acute = Math.round(load(shift(today, -7), today));
  const chronic = Math.round(load(shift(today, -28), today) / 4);
  // A ratio only means something with a real baseline: sessions logged in each of the last 4 weeks.
  const enoughHistory = [0, 1, 2, 3].every((w) => sessions.some((a) => { const d = days(a.date, today); return d >= w * 7 && d < (w + 1) * 7; }));
  const acwr = enoughHistory && chronic > 0 ? Math.round((acute / chronic) * 100) / 100 : null;

  // Weekly run km (last 4 calendar weeks ending today) and 28-day easy share.
  const weekKm = [3, 2, 1, 0].map((w) => Math.round(runs.filter((a) => {
    const d = days(a.date, today); return d >= w * 7 && d < (w + 1) * 7;
  }).reduce((s, a) => s + (a.km || 0), 0) * 10) / 10);
  const recentHr = runs.filter((a) => days(a.date, today) < 28 && a.hr && a.duration);
  const totalMin = recentHr.reduce((s, a) => s + sec(a.duration), 0);
  const easyShare = easyCeil && totalMin ? Math.round((recentHr.filter((a) => a.hr <= easyCeil).reduce((s, a) => s + sec(a.duration), 0) / totalMin) * 100) : null;

  const drift = runs.filter((a) => days(a.date, today) <= 120).map((a) => ({ date: a.date, pct: decoupling(a) })).filter((d) => d.pct != null);

  // Easy-pace evidence: continuous runs (no walk breaks) at or under the easy HR ceiling.
  const easyRuns = easyCeil ? runs.filter((a) => a.hr && a.hr <= easyCeil && a.km >= 3 && a.duration && days(a.date, today) <= 60 &&
    !/walk|走/i.test(`${a.title || ""} ${a.note || ""}`)).slice(-3).map((a) => ({ date: a.date, km: a.km, pace: mmss(sec(a.duration) / a.km), hr: a.hr })) : [];

  // Easy pace from the runner's own HR. Each continuous run (≥ 3 km, last 60 days) calibrates pace ↔ HR: Swain's
  // %VO2-reserve ≈ %HR-reserve (or %VO2max = (%HRmax − 37) / 0.64 without a resting HR) with Daniels' VO2 cost of
  // running gives an aerobic capacity per run; the median of those, put back through the same relations, gives the pace
  // at the easy ceiling (fast end) and ~10 points of reserve lower (slow end). A VDOT from a sub-maximal run can't
  // do this: it is only a floor, so its E paces come out slower than what the HR ceiling allows.
  let hrEasy = null;
  if (easyCeil && maxHr) {
    const frac = (h) => (restHr ? (h - restHr) / (maxHr - restHr) : ((h / maxHr) * 100 - 37) / 64);
    const cap = (f, V) => (restHr ? 3.5 + (V - 3.5) * f : V * f); // VO2 at fraction f of capacity V
    const est = runs.filter((a) => a.hr && a.km >= 3 && a.duration && days(a.date, today) <= 60 &&
      !/walk|走/i.test(`${a.title || ""} ${a.note || ""}`))
      .map((a) => { const f = frac(a.hr), v = (a.km * 1000) / (sec(a.duration) / 60);
        return f >= 0.5 && f <= 0.92 ? (restHr ? 3.5 + (vo2(v) - 3.5) / f : vo2(v) / f) : null; })
      .filter((V) => V > 20 && V < 85).sort((x, y) => x - y);
    if (est.length) {
      const V = est.length % 2 ? est[(est.length - 1) / 2] : (est[est.length / 2 - 1] + est[est.length / 2]) / 2;
      const speed = (o2) => (-0.182258 + Math.sqrt(0.182258 ** 2 + 4 * 0.000104 * (o2 + 4.6))) / (2 * 0.000104);
      const paceAtHr = (h) => mmss(60000 / speed(cap(frac(h), V)));
      const slowHr = restHr ? Math.round(easyCeil - 0.1 * (maxHr - restHr)) : easyCeil - 12;
      hrEasy = { fast: paceAtHr(easyCeil), slow: paceAtHr(slowHr), slowHr, n: est.length };
    }
  }

  const m = { maxHr, seenMax, maxFrom, restHr, easyCeil, acute, chronic, acwr, weekKm, easyShare, drift, easyRuns, hrEasy };
  if (race && basis?.kind === "floor") m.raceRef = { V: Math.round(race.V * 10) / 10, date: race.a.date, km: race.a.km, time: race.a.duration };
  if (basis) {
    m.vdot = Math.round(basis.V * 10) / 10;
    m.vdotKind = basis.kind;
    m.vdotFrom = { date: basis.a.date, km: basis.a.km, time: basis.a.duration, effort: basis.effort };
    m.paces = trainingPaces(basis.V);
    m.pred5k = hms(predict(basis.V, 5000));
  }
  if (goal5k) { m.goal5k = hms(goal5k); m.goalVdot = Math.round(vdot(5000, goal5k) * 10) / 10; }
  return m;
}

/** Plain lines for the prompt (with the reasoning) and short lines for the card. */
export function describeMetrics(m) {
  const prompt = [], card = [];
  if (m.vdot) {
    const f = m.vdotFrom;
    const src = `${f.time} for ${f.km} km on ${f.date}${f.effort ? ` at ${f.effort}% of max HR seen` : ""}`;
    const p = m.paces;
    if (m.vdotKind === "all-out") {
      prompt.push(`CURRENT FITNESS: VDOT ${m.vdot} from an all-out effort (${src}). Equivalent 5K ≈ ${m.pred5k}.`);
      card.push(`Fitness: VDOT ${m.vdot} (${f.time} / ${f.km} km, ${f.date.slice(5)}) → 5K ≈ ${m.pred5k}`);
    } else {
      prompt.push(`CURRENT FITNESS: VDOT at least ${m.vdot} (${src}; not all-out, so real fitness is higher). 5K ≈ ${m.pred5k} or faster.` +
        (m.raceRef ? ` Last all-out effort: ${m.raceRef.time} for ${m.raceRef.km} km on ${m.raceRef.date} = VDOT ${m.raceRef.V}, so fitness has improved since.` : "") +
        ` Because this is a lower bound, the paces below are the SLOW end: set easy runs by the HR ceiling, not by pace.`);
      card.push(`Fitness: VDOT ≥ ${m.vdot} (${f.time} / ${f.km} km, ${f.date.slice(5)}, not all-out) → 5K ≤ ${m.pred5k}` +
        (m.raceRef ? `; was ${m.raceRef.V} on ${m.raceRef.date.slice(5)}` : ""));
    }
    prompt.push(`TRAINING PACES FOR THIS FITNESS (Daniels): E ${p.E[0]}–${p.E[1]}, M ${p.M}, T ${p.T}, I ${p.I}, R ${p.R} /km.`);
    // Easy pace on the card comes from their HR when it can (line below); the VDOT one would contradict it.
    card.push(`${m.vdotKind === "all-out" ? "Paces now" : "Paces (at least)"}: ${m.hrEasy ? "" : `E ${p.E[0]}–${p.E[1]} · `}T ${p.T} · I ${p.I} /km`);
  }
  if (m.goalVdot) {
    const gap = m.vdot ? Math.round((m.goalVdot - m.vdot) * 10) / 10 : null;
    prompt.push(`GOAL: 5K ${m.goal5k} needs VDOT ${m.goalVdot}${gap != null ? `; gap ${gap > 0 ? gap : 0} points` : ""}. ` +
      `The plan's paces are set for the goal; easy runs should use CURRENT-fitness E pace, quality runs can move toward goal pace as fitness improves.`);
    card.push(`Goal ${m.goal5k} needs VDOT ${m.goalVdot}${gap > 0 ? ` (gap ${gap})` : " (on track)"}`);
  }
  if (m.maxHr) {
    const src = m.maxFrom === "set" ? `max ${m.maxHr} (the runner's own, from a race or test${m.seenMax ? `; highest logged ${m.seenMax}` : ""})`
      : `highest seen ${m.maxHr} (true max is at least this)`;
    const how = m.restHr ? `resting ${m.restHr} + 74% of heart-rate reserve` : "≈ 79% of max";
    prompt.push(`HR: ${src}. Easy ceiling = ${how} = ${m.easyCeil} bpm. A watch's wider "aerobic" zone (often up to ` +
      `~84% of max) is moderate effort, not easy: if the runner quotes it, explain the difference with these numbers.`);
    card.push(`HR: max ${m.maxHr}${m.maxFrom === "seen" ? " seen" : ""}${m.restHr ? `, resting ${m.restHr}` : ""} → easy ≤ ${m.easyCeil}` +
      ` (${m.restHr ? "74% of reserve" : "79% of max"})`);
  }
  if (m.hrEasy) {
    const e = m.hrEasy;
    prompt.push(`EASY PACE FROM THEIR OWN HR (${e.n} recent run${e.n > 1 ? "s" : ""}): HR ≤ ${m.easyCeil} ≈ ${e.fast}/km; ` +
      `HR ${e.slowHr} ≈ ${e.slow}/km. For easy runs give ~${e.fast}–${e.slow}/km with the HR cap as the rule; slower is always fine. ` +
      `HR drifts up over long runs, so start near the slow end. Use this, not the VDOT E pace, for easy-run pace.`);
    card.push(`Easy pace at HR ≤ ${m.easyCeil}: ~${e.fast}–${e.slow} /km (from your runs)`);
  }
  if (m.easyRuns?.length) {
    const ev = m.easyRuns.map((r) => `${r.date.slice(5)} ${r.pace}/km @ HR ${r.hr}`).join(", ");
    prompt.push(`EASY EVIDENCE (continuous runs at easy HR): ${ev}. This is their real easy pace today.`);
    card.push(`Easy pace seen at easy HR: ${ev}`);
  }
  if (m.easyShare != null) {
    prompt.push(`INTENSITY (28 d): ${m.easyShare}% of run time at easy HR (≤ ${m.easyCeil}); polarized guideline ~80%.`);
    card.push(`Easy share (28 d): ${m.easyShare}% of run time (aim ~80%)`);
  }
  prompt.push(`LOAD (HR-weighted minutes): last 7 d ${m.acute}` +
    (m.acwr != null ? `, 28-d weekly avg ${m.chronic}, ratio ${m.acwr} (0.8–1.3 normal, >1.5 spike)`
      : " (no baseline yet: needs sessions logged in each of the last 4 weeks, so don't compare it with earlier weeks)") +
    `. Run km LOGGED per week, oldest→this week: ${m.weekKm.join(", ")}` +
    (m.weekKm.some((k) => !k) ? " (0 = nothing logged here; the runner may have trained without logging, so never call it a layoff or a jump)" : "") + ".");
  card.push(m.acwr != null ? `Load ratio 7 d / 28 d: ${m.acwr}${m.acwr > 1.5 ? " (spike)" : m.acwr < 0.8 ? " (low)" : ""}` : `Run km logged / week: ${m.weekKm.join(" → ")}`);
  for (const d of m.drift.slice(-3)) {
    prompt.push(`DECOUPLING ${d.date}: efficiency (speed ÷ HR) fell ${d.pct}% from first to second half` +
      ` (<5% = good aerobic durability; >10% = went out too fast or under-fuelled).`);
  }
  return { prompt: prompt.join("\n"), card };
}
