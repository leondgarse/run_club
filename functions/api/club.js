// GET /api/club?person=WGW&today=YYYY-MM-DD -> { text }   the CLUB section (lib/club.js) for WGW's private morning step,
// which writes WGW's suggestion outside this site. TJH/SJH get theirs inside /api/today.
import { DATE, HttpError, fromQuery, handle, json } from "../../lib/shared.js";
import { clubContext } from "../../lib/club.js";

export const onRequestGet = handle(async ({ request, env }) => {
  const q = fromQuery(request);
  if (q.person !== "WGW") throw new HttpError(400, "bad person");
  const today = DATE.test(q.today || "") ? q.today : new Date().toISOString().slice(0, 10);
  return json({ text: await clubContext(env, "WGW", today) });
});
