// Running-form checks, computed in code so the model only phrases them.
// Bands follow Garmin's running-dynamics colour zones (approximate; they're population norms, not rules).
//   label per band, from best to worst; the value falls in the first band whose upper bound it doesn't exceed.
const BANDS = {
  cadence:     { name: "cadence", unit: "spm", higherIsBetter: true, cuts: [183, 174, 164, 153], labels: ["excellent", "good", "average", "low", "very low"] },
  gct_ms:      { name: "ground contact", unit: "ms", cuts: [218, 248, 277, 308], labels: ["excellent", "good", "average", "long", "very long"] },
  vert_osc_cm: { name: "vertical oscillation", unit: "cm", cuts: [6.4, 8.1, 9.7, 11.5], labels: ["excellent", "good", "average", "high", "very high"] },
  vert_ratio:  { name: "vertical ratio (oscillation ÷ stride)", unit: "%", cuts: [6.1, 7.4, 8.6, 10.1], labels: ["excellent", "good", "average", "high", "very high"] },
};

function band(key, v) {
  const b = BANDS[key];
  let i = 0;
  if (b.higherIsBetter) { while (i < b.cuts.length && v < b.cuts[i]) i++; }
  else { while (i < b.cuts.length && v > b.cuts[i]) i++; }
  return `${b.name} ${v}${b.unit === "%" ? "%" : " " + b.unit} = ${b.labels[i].toUpperCase()}`;
}

/** Form metrics of one run as {key: value}, adding the vertical ratio when oscillation and stride are known. */
export function formMetrics(a) {
  let x = {};
  try { x = a.extra ? JSON.parse(a.extra) : {}; } catch {}
  const m = {};
  if (a.cadence) m.cadence = a.cadence;
  if (x.gct_ms) m.gct_ms = x.gct_ms;
  if (x.vert_osc_cm) m.vert_osc_cm = x.vert_osc_cm;
  if (x.vert_osc_cm && x.stride_m) m.vert_ratio = Math.round((x.vert_osc_cm / (x.stride_m * 100)) * 1000) / 10;
  if (x.lr_balance) m.lr_balance = x.lr_balance;
  return m;
}

/** "FORM CHECK" text for one run, or "" if nothing to say. */
export function formCheck(a) {
  if (a.type !== "run") return "";
  const m = formMetrics(a);
  const out = Object.keys(BANDS).filter((k) => m[k] != null).map((k) => band(k, m[k]));
  if (m.lr_balance != null) {
    const off = Math.round(Math.abs(m.lr_balance - 50) * 10) / 10;
    out.push(`L/R balance ${m.lr_balance}/${Math.round((100 - m.lr_balance) * 10) / 10} = ${off <= 0.7 ? "BALANCED" : off <= 1.5 ? "SLIGHTLY " + (m.lr_balance > 50 ? "LEFT" : "RIGHT") + "-HEAVY" : "UNEVEN (" + (m.lr_balance > 50 ? "left" : "right") + "-heavy)"}`);
  }
  return out.join("; ");
}

const bandIndex = (key, v) => {
  const b = BANDS[key];
  let i = 0;
  if (b.higherIsBetter) { while (i < b.cuts.length && v < b.cuts[i]) i++; }
  else { while (i < b.cuts.length && v > b.cuts[i]) i++; }
  return i; // 0 excellent … 4 worst
};
const range = (xs, unit) => {
  const lo = Math.min(...xs), hi = Math.max(...xs);
  return `${lo === hi ? lo : `${lo}–${hi}`}${unit}`;
};

/**
 * Deterministic form note from the most recent runs that have running dynamics (newest first, up to 4).
 * Flags a metric only when it's off on at least 2 of those runs. Returns null when nothing persists.
 */
export function formTrend(runs) {
  const f = formFlags(runs);
  return f ? f.text : null;
}

/** Same analysis as formTrend, structured: {n, vr, vo, cad, gct, bal, balSide, text} (arrays of off values). */
export function formFlags(runs) {
  const rs = runs.filter((a) => a.type === "run").map(formMetrics)
    .filter((m) => m.vert_osc_cm != null || m.gct_ms != null).slice(0, 4);
  if (rs.length < 2) return null;
  const off = (key, test) => rs.map((m) => m[key]).filter((v) => v != null && test(v));
  const issues = [], cues = [];
  const vr = off("vert_ratio", (v) => bandIndex("vert_ratio", v) >= 3);
  const vo = off("vert_osc_cm", (v) => v >= 9.0);
  const cad = off("cadence", (v) => bandIndex("cadence", v) >= 3);
  const gct = off("gct_ms", (v) => bandIndex("gct_ms", v) >= 3);
  const bal = off("lr_balance", (v) => Math.abs(v - 50) > 1.0);
  if (vr.length >= 2) issues.push(`vertical ratio high on ${vr.length} of the last ${rs.length} runs (${range(vr, "%")})`);
  else if (vo.length >= 2) issues.push(`vertical oscillation near the high end on ${vo.length} of the last ${rs.length} runs (${range(vo, " cm")})`);
  if (cad.length >= 2) issues.push(`cadence low (${range(cad, " spm")})`);
  if (vr.length >= 2 || vo.length >= 2 || cad.length >= 2) cues.push("aim for ~5% quicker cadence with shorter steps and a quiet landing, rather than pushing off upward");
  if (gct.length >= 2) { issues.push(`ground contact long (${range(gct, " ms")})`); cues.push("quick, light feet"); }
  if (bal.length >= 2) {
    const left = bal.filter((v) => v > 50).length >= bal.length / 2;
    issues.push(`${left ? "left" : "right"}-heavy L/R balance (${range(bal.map((v) => (left ? v : Math.round((100 - v) * 10) / 10)), "%")} ${left ? "left" : "right"})`);
    cues.push("if the imbalance persists or something niggles, add single-leg strength work");
  }
  if (!issues.length) return null;
  const s = issues.join("; ");
  const side = bal.length >= 2 ? (bal.filter((v) => v > 50).length >= bal.length / 2 ? "left" : "right") : null;
  return { n: rs.length, vr: vr.length >= 2 ? vr : [], vo: vr.length < 2 && vo.length >= 2 ? vo : [],
    cad: cad.length >= 2 ? cad : [], gct: gct.length >= 2 ? gct : [], bal: side ? bal : [], balSide: side,
    text: `${s[0].toUpperCase()}${s.slice(1)}. Cue: ${cues.join("; ")}.` };
}
