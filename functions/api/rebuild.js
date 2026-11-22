// Plan rebuild (lib/rebuild.js): Claude rewrites the rest of a runner's plan from their data; they accept it in the app.
//   GET    /api/rebuild?person=TJH&today=     -> { prompt, start, end }     for scripts/plan_rebuild.py (Claude on the Mac)
//   POST   /api/rebuild { person, today, draft } -> { proposal }  checked against the computed limits (400 with the reason)
//   DELETE /api/rebuild?person=TJH            -> dismiss the waiting proposal
// Accepting goes through /api/plan like any plan change (it then deletes the proposal).
import { DATE, HttpError, fromQuery, handle, json } from "../../lib/shared.js";
import { checkRebuild, rebuildContext, rebuildPrompt } from "../../lib/rebuild.js";
import { CHANGEABLE } from "../../public/plans.js";

const day = (t) => (DATE.test(t || "") ? t : new Date().toISOString().slice(0, 10));
const who = (p) => { if (!CHANGEABLE.has(p) || p === "WGW") throw new HttpError(400, "bad person"); return p; };

export const onRequestGet = handle(async ({ request, env }) => {
  const q = fromQuery(request), p = who(q.person);
  let ctx;
  try { ctx = await rebuildContext(env, p, day(q.today)); } catch (e) { throw new HttpError(409, e.message); }
  return json({ prompt: rebuildPrompt(ctx), start: ctx.start, end: ctx.end });
});

export const onRequestPost = handle(async ({ request, env }) => {
  const b = await request.json().catch(() => ({}));
  const p = who(b.person);
  let proposal;
  try { proposal = checkRebuild(b.draft, await rebuildContext(env, p, day(b.today))); } catch (e) { throw new HttpError(400, e.message); }
  await env.DB.prepare("INSERT INTO plan_proposals (person, data, created_at) VALUES (?1, ?2, ?3) " +
    "ON CONFLICT(person) DO UPDATE SET data=?2, created_at=?3").bind(p, JSON.stringify(proposal), new Date().toISOString()).run();
  return json({ proposal });
});

export const onRequestDelete = handle(async ({ request, env }) => {
  const p = who(fromQuery(request).person);
  await env.DB.prepare("DELETE FROM plan_proposals WHERE person=?1").bind(p).run();
  return json({ ok: true });
});
