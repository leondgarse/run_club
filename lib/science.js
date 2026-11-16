// Exercise-science / sports-rehab layer: turns computed form flags and coaching numbers into mechanisms
// (why it matters for tissues and joints) and a concrete prehab routine. Rule-based, so it never invents.
// Muscle roles follow the club's anatomy notes (joint action → prime movers): plantarflexion = gastrocnemius
// (straight knee) + soleus (bent knee); hip extension = glute max + hamstrings (+ adductor magnus);
// pelvic stability in single-leg stance = glute medius; knee tracking = VMO; trunk = anti-extension/anti-rotation.

/**
 * @param flags  formFlags(...) result or null
 * @param m      coachMetrics(...) result
 * @param late   true if recent runs started at/after 22:00
 * @returns {{prompt: string, prehab: string[]}}
 */
export function sportsScience(flags, m, late = false) {
  const why = [], prehab = [];
  const add = (x) => { if (!prehab.includes(x)) prehab.push(x); };

  if (flags?.cad.length || flags?.vr.length || flags?.vo.length) {
    const cad = flags.cad.length ? Math.max(...flags.cad) : null;
    why.push("Low cadence with a long stride usually means the foot lands ahead of the centre of mass (overstriding): " +
      "a bigger braking impulse each step, more load on the patellofemoral joint and tibia, and energy spent moving up " +
      "instead of forward (high vertical ratio). Raising cadence 5–10% at the same pace measurably lowers knee and hip " +
      "loading (Heiderscheit et al., 2011). Cue: land under the hips, lean from the ankles, not the waist.");
    add(`Cadence drill: metronome at ${cad ? `~${Math.round(cad * 1.05)}` : "+5%"} spm, 1 min on / 1 min off during easy runs; then 4–6 × 20 s relaxed strides`);
    add("Glute bridge or hip thrust 3×12 (glute max: drives hip extension backward, not up)");
  }
  if (flags?.gct.length) {
    why.push("Long ground contact means less elastic return from the Achilles–calf spring. In running the soleus carries " +
      "the largest force of any muscle (several times body weight per step), and calf/Achilles capacity is the usual " +
      "limiter in newer runners.");
  }
  if (flags?.gct.length || flags?.cad.length) {
    add("Calf raises, slow 3 s down: straight-knee 3×15 (gastrocnemius) + bent-knee 3×15 (soleus); single-leg once easy");
  }
  if (flags?.bal.length) {
    why.push(`Ground-contact balance has been ${flags.balSide}-heavy on ${flags.bal.length} runs. Asymmetry over ~1.5% often ` +
      "points to a weaker side or an old niggle; contact time alone doesn't say which side is weaker (a sore side is often offloaded, not overloaded). The stance leg's glute medius controls pelvic drop, and the VMO controls " +
      "knee tracking; both fade first when one side is weaker. Pain or tightness on one side is the signal to stop and get it checked.");
    add("Find the weaker side first: max single-leg calf raises and 10 single-leg squats to a box, each leg; a gap of >10–15% is real");
    add("Single-leg work, weaker side first: Bulgarian split squat 3×8/leg, single-leg RDL 3×8/leg");
    add("Glute medius: side-lying hip abduction or banded lateral walk 2×15/side");
  }
  if (!prehab.length) {
    // No recurring form issue: the standard base routine for runners (calf–Achilles capacity, hip extensors, pelvic control).
    add("Base routine (no recurring form issues in the data): calf raises, slow 3 s down, straight-knee 3×15 (gastrocnemius) + bent-knee 3×15 (soleus)");
    add("Glute bridge 3×12, then single-leg once easy (glute max + hamstrings: hip extension)");
    add("Banded lateral walk or side-lying hip abduction 2×15/side (glute medius: keeps the pelvis level on one leg)");
  }
  add("Core anti-extension: dead bug 3×8/side or plank 3×30 s (keeps the pelvis neutral so hip drive isn't lost)");

  if (m.easyShare != null && m.easyShare < 70) {
    why.push(`Physiology of the easy share (${m.easyShare}% vs ~80%): runs at or under ~79% of max HR build mitochondria, ` +
      "capillaries and fat oxidation with little stress, so they can be repeated daily. Moderate \"grey zone\" runs " +
      "pile up fatigue without the stimulus that real intervals give.");
  }
  const wk = m.weekKm || [];
  if (wk.filter(Boolean).length && wk[3] > 0 && wk[2] >= 0) {
    why.push("Tissue adaptation: heart and lungs adapt in weeks, but tendon, bone and cartilage take months. Most running " +
      "injuries in newer runners are load errors. Keep weekly km increases to about 10% and the long run to ≤ 30–35% of the week.");
  }
  if (late) {
    why.push("Late runs: hard running within 1–2 h of bed raises core temperature and sympathetic tone and delays sleep. " +
      "Deep sleep is when most tissue repair and growth-hormone release happen.");
  }
  why.push("Recovery tools: on rest days an easy 30–40 min swim or walk is active recovery (low impact, keeps blood flow). " +
    "Do prehab after easy runs or on rest days, not before quality sessions.");

  return {
    prompt: `SPORTS-SCIENCE NOTES (mechanisms, from biomechanics, exercise physiology and running-injury research):\n- ${why.join("\n- ")}` +
      (prehab.length ? `\nPREHAB ROUTINE (computed from their form data, 2×/week, ~15 min): ${prehab.join("; ")}.` : ""),
    prehab,
  };
}
