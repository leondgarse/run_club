// Plan/week helpers shared by the coach and daily-suggestion functions.
import { planFor } from "../public/plans.js";

export const addWeeks = (w, n) => new Date(Date.parse(w + "T00:00:00Z") + n * 7 * 864e5).toISOString().slice(0, 10);
export const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const sec = (t) => t.split(":").map(Number).reduce((a, x) => a * 60 + x, 0);
export const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Deterministic pace/HR verdicts so the model doesn't have to compare numbers itself. */
export function verdicts(r, target) {
  if (!target) return [];
  const out = [];
  let pace = r.pace ? sec(r.pace) : r.km && r.duration ? sec(r.duration) / r.km : null;
  if (pace && target.pace) {
    const [lo, hi] = target.pace.map((t) => (t ? sec(t) : null));
    const range = `${target.pace[0] || "any"}–${target.pace[1] || "any"}/km`;
    if (lo && pace < lo) out.push(`pace ${mmss(pace)} is ${Math.round(lo - pace)} s/km FASTER than target ${range}`);
    else if (hi && pace > hi) out.push(`pace ${mmss(pace)} is ${Math.round(pace - hi)} s/km SLOWER than target ${range}`);
    else out.push(`pace ${mmss(pace)} is WITHIN target ${range}`);
  }
  if (r.hr && target.hr) {
    const [lo, hi] = target.hr;
    const range = lo && hi ? `${lo}–${hi}` : lo ? `≥ ${lo}` : `≤ ${hi}`;
    if (hi && r.hr > hi) out.push(`HR ${r.hr} is ${r.hr - hi} bpm ABOVE target ${range}`);
    else if (lo && r.hr < lo) out.push(`HR ${r.hr} is ${lo - r.hr} bpm BELOW target ${range}`);
    else out.push(`HR ${r.hr} is WITHIN target ${range}`);
  }
  return out;
}

export function describeWeek(person, week, rows, todayIdx) {
  const plan = planFor(person, week);
  if (plan.empty) return `Week of ${week}: no plan.`;
  const byItem = Object.fromEntries(rows.filter((r) => r.week === week).map((r) => [r.item, r]));
  const lines = plan.items.filter((i) => !i.rest).map((i) => {
    const r = byItem[i.id];
    const date = new Date(Date.parse(week + "T00:00:00Z") + i.dayIndex * 864e5).toISOString().slice(5, 10);
    const planned = `${i.day} ${date} ${i.kind}: ${i.title}${i.meta ? ` (${i.meta})` : ""}`;
    if (!r) {
      const upcoming = todayIdx != null && i.dayIndex >= todayIdx;
      return `- ${planned} → ${upcoming ? "upcoming" : "NOT done"}`;
    }
    const got = [r.km && `${r.km} km`, r.duration && `time ${r.duration}`, r.pace && `pace ${r.pace}/km`,
      r.hr && `avg HR ${r.hr}`, r.note && `note: "${r.note}"`].filter(Boolean).join(", ");
    const v = verdicts(r, i.target);
    return `- ${planned} → DONE${got ? ` (${got})` : " (no details logged)"}${v.length ? `\n    CHECK: ${v.join("; ")}` : ""}`;
  });
  return `${plan.title} (week of ${week}, ${plan.sub}):\n${lines.join("\n")}`;
}

