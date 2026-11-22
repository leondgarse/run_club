// Chart data for TJH's and SJH's tabs, computed from their logged runs. Shared by the site, the mini program
// (copied by scripts/mp-sync.sh) and the server (lib/metrics.js and lib/goal.js take the HR zone and race distance
// from here, so the charts and the daily suggestion use the same numbers).

const sec = (t) => String(t || "").split(":").reduce((a, b) => a * 60 + +b, 0);
const dayNo = (d) => Date.parse(d + "T00:00:00Z") / 864e5;
const shift = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const mondayOf = (d) => shift(d, -((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7));
export const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const parseX = (a) => { try { return a.extra ? JSON.parse(a.extra) : {}; } catch { return {}; } };
const nums = (s) => String(s || "").split(/\s+/).map(Number).filter((n) => n > 0);

/**
 * Max HR (the runner's own from a race/test, else the highest seen; the logs win if they beat it) and the easy
 * ceiling: Daniels' E zone ≈ 65–79% of max ≈ 59–74% of heart-rate reserve (Karvonen) when a resting HR is given.
 * @param runs [{hr, extra}] @param hr {max_hr, rest_hr}
 */
export function hrZone(runs, hr = {}) {
  let seenMax = 0;
  for (const a of runs) { const x = parseX(a); seenMax = Math.max(seenMax, a.hr || 0, x.max_hr || 0, ...nums(x.split_hr)); }
  seenMax = seenMax >= 150 ? seenMax : null;
  const setMax = hr?.max_hr || null;
  const maxHr = Math.max(seenMax || 0, setMax || 0) || null;
  const maxFrom = setMax && setMax >= (seenMax || 0) ? "set" : "seen";
  const restHr = hr?.rest_hr && maxHr && hr.rest_hr <= maxHr - 60 ? hr.rest_hr : null;
  const easyCeil = maxHr ? Math.round(restHr ? restHr + 0.74 * (maxHr - restHr) : maxHr * 0.79) : null;
  return { maxHr, seenMax, maxFrom, restHr, easyCeil };
}

/** Race distance in km from the target text, or null ("half" → 21.1, "marathon" → 42.2, "10K" → 10 ...). */
export function raceKm(text) {
  const t = String(text || "").toLowerCase();
  if (/\bhalf\b|half[- ]?marathon|\bhm\b|21(\.1)? ?k/.test(t)) return 21.1;
  if (/\bmarathon\b|\bfm\b|42(\.2)? ?k/.test(t)) return 42.2;
  const k = t.match(/\b(\d{1,2}(?:\.\d)?) ?k(m)?\b/);
  return k ? Number(k[1]) : null;
}

/** Goal time in seconds from the target text ("in 20 mins", "sub-24", "1:45:00", "under 24:00"), or null. */
export function goalSeconds(text) {
  const t = String(text || "").toLowerCase();
  const hms = t.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
  if (hms) return hms[3] != null ? +hms[1] * 3600 + +hms[2] * 60 + +hms[3] : +hms[1] * 60 + +hms[2];
  const min = t.match(/(?:sub[- ]?|in |under )(\d{2,3})\s*(?:min|mins|minutes|分)?\b/) || t.match(/\b(\d{2,3})\s*(?:min|mins|minutes)\b/);
  return min ? +min[1] * 60 : null;
}

const isWalk = (a) => /walk|走/i.test(`${a.title || ""} ${a.note || ""}`);

/**
 * @param runs   [{date, km, duration, hr, title, note, extra}] the runner's runs (activities + ticked sessions, once each)
 * @param goal   {text, date, max_hr, rest_hr} or null
 * @returns { zone, eff, scatter, goal } — each chart null when there isn't enough to draw
 */
export function chartData(runs, today, goal = null) {
  const zone = hrZone(runs, goal || {});
  const recent = runs.filter((a) => a.km > 0 && a.duration && a.date <= today && dayNo(today) - dayNo(a.date) <= 120 && !isWalk(a))
    .map((a) => ({ ...a, pace: sec(a.duration) / a.km })).sort((x, y) => (x.date < y.date ? -1 : 1));

  // 1. Aerobic efficiency on easy runs: metres per heartbeat (speed ÷ HR). Easy runs only, so like is compared with like.
  let eff = null;
  if (zone.easyCeil) {
    const pts = recent.filter((a) => a.hr && a.km >= 3 && a.hr <= zone.easyCeil)
      .map((a) => ({ date: a.date, v: Math.round(((1000 / a.pace) * 60 / a.hr) * 100) / 100, pace: mmss(a.pace), hr: a.hr, km: a.km }));
    if (pts.length >= 2) {
      let trend = null;
      // A trend needs a real span: 4+ runs over 3+ weeks (a few days of data would extrapolate noise).
      if (pts.length >= 4 && dayNo(pts[pts.length - 1].date) - dayNo(pts[0].date) >= 21) { // least squares over days
        const xs = pts.map((p) => dayNo(p.date)), ys = pts.map((p) => p.v), n = xs.length;
        const mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
        const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
        const slope = sxx ? xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx : 0;
        trend = { from: my + slope * (xs[0] - mx), to: my + slope * (xs[n - 1] - mx), per4w: Math.round(slope * 28 * 100) / 100 };
      }
      eff = { points: pts, trend, ceil: zone.easyCeil };
    }
  }

  // 2. Pace vs heart rate, every run with HR (last 120 days).
  const sp = recent.filter((a) => a.hr && a.km >= 1).map((a) => ({ date: a.date, hr: a.hr, pace: a.pace, paceText: mmss(a.pace), km: a.km }));
  const scatter = sp.length >= 2 ? { points: sp, ceil: zone.easyCeil } : null;

  // 3. Goal chart: a long race → longest run per week toward the race distance; a short one → times over that distance.
  let goalChart = null;
  const rk = raceKm(goal?.text);
  if (rk && rk >= 10) {
    const weeks = [];
    for (let i = 9; i >= 0; i--) weeks.push(shift(mondayOf(today), -7 * i));
    const bars = weeks.map((w) => ({ week: w, km: Math.max(0, ...runs.filter((a) => a.date >= w && a.date <= shift(w, 6) && a.km > 0).map((a) => +a.km)) }));
    if (bars.some((b) => b.km)) goalChart = { kind: "long", bars, target: rk, date: goal.date || null };
  } else if (rk) {
    const target = goalSeconds(goal?.text);
    const pts = recent.filter((a) => a.km >= rk * 0.9 && a.km <= rk * 1.15)
      .map((a) => ({ date: a.date, t: Math.round(a.pace * rk), time: mmss(Math.round(a.pace * rk)), km: a.km }));
    if (pts.length) goalChart = { kind: "time", points: pts, target, km: rk, date: goal.date || null };
  }
  return { zone, eff, scatter, goal: goalChart };
}
