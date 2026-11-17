// Ask for today's TJH/SJH suggestion to be rewritten now (e.g. after adding an activity), max 5 per runner per day.
//   POST /api/refresh { person, today } -> { used, left, pending, failed }   (429 when the day's refreshes are used up)
//   GET  /api/refresh?pending=1         -> { pending: [{ person, date, requested_at }] }   (polled by scripts/refresh.sh)
// The site can't run Claude: the request waits here until the Mac picks it up (usually within ~2 min), writes the
// suggestion and marks the row done (a failed one gets its count back).
import { DATE, HttpError, REFRESH_LIMIT, handle, json, refreshInfo } from "../../lib/shared.js";

const SELF = new Set(["TJH", "SJH"]);

export const onRequestPost = handle(async ({ request, env }) => {
  const body = await request.json().catch(() => ({}));
  const { person, today } = body;
  if (!SELF.has(person) || !DATE.test(today || "")) throw new HttpError(400, "bad input");
  // The day is the runner's local date; only accept one close to the server's, so the limit can't be dodged.
  if (Math.abs(Date.parse(today + "T12:00:00Z") - Date.now()) > 36 * 3600e3) throw new HttpError(400, "bad date");

  const now = new Date().toISOString();
  // New request only when none is pending and the limit isn't reached; otherwise nothing changes.
  const up = await env.DB.prepare(
    "INSERT INTO refreshes (person, date, count, requested_at, done_at, failed) VALUES (?1, ?2, 1, ?3, NULL, 0) " +
    "ON CONFLICT(person, date) DO UPDATE SET count = count + 1, requested_at = ?3, done_at = NULL, failed = 0 " +
    `WHERE refreshes.count < ${REFRESH_LIMIT} AND refreshes.done_at IS NOT NULL RETURNING count`,
  ).bind(person, today, now).first();
  const row = await env.DB.prepare("SELECT * FROM refreshes WHERE person=?1 AND date=?2").bind(person, today).first();
  const info = refreshInfo(row);
  if (!up && !info.pending) throw new HttpError(429, `All ${REFRESH_LIMIT} refreshes for today are used`);
  return json(info);
});

export const onRequestGet = handle(async ({ env }) => {
  const { results } = await env.DB.prepare(
    "SELECT person, date, requested_at FROM refreshes WHERE requested_at IS NOT NULL AND done_at IS NULL ORDER BY requested_at",
  ).all();
  return json({ pending: results });
});
