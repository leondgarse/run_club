// Photos/screenshots of a My log activity, up to 3 (idx 0-2).
//   GET    /api/actphoto?person=&id=&idx=   -> the image
//   PUT    /api/actphoto?person=&id=&idx=   raw jpeg/png/webp body, ≤ 1.5 MB (the app resizes before upload)
//   DELETE /api/actphoto?person=&id=&idx=
import { HttpError, PEOPLE, fromB64, fromQuery, handle, json, toB64 } from "../../lib/shared.js";

const MAX = 1.5 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTOS = 3;

async function target(request, env) {
  const q = fromQuery(request);
  const id = Number(q.id), idx = Number(q.idx);
  if (!PEOPLE.has(q.person) || !(id > 0) || !Number.isInteger(idx) || idx < 0 || idx >= MAX_PHOTOS) throw new HttpError(400, "bad input");
  const own = await env.DB.prepare("SELECT 1 FROM activities WHERE id=?1 AND person=?2").bind(id, q.person).first();
  if (!own) throw new HttpError(404, "activity not found");
  return { id, idx };
}

export const onRequestGet = handle(async ({ request, env }) => {
  const { id, idx } = await target(request, env);
  const row = await env.DB.prepare("SELECT mime, data FROM activity_photos WHERE activity_id=?1 AND idx=?2").bind(id, idx).first();
  if (!row) throw new HttpError(404, "no photo");
  return new Response(fromB64(row.data), { headers: { "content-type": row.mime, "cache-control": "private, max-age=86400" } });
});

export const onRequestPut = handle(async ({ request, env }) => {
  const { id, idx } = await target(request, env);
  const mime = (request.headers.get("content-type") || "").split(";")[0];
  if (!TYPES.has(mime)) throw new HttpError(415, "unsupported image type");
  const buf = await request.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > MAX) throw new HttpError(413, "image too large");
  await env.DB.prepare(
    "INSERT INTO activity_photos (activity_id, idx, mime, data, created_at) VALUES (?1, ?2, ?3, ?4, ?5) " +
    "ON CONFLICT(activity_id, idx) DO UPDATE SET mime=excluded.mime, data=excluded.data, created_at=excluded.created_at",
  ).bind(id, idx, mime, toB64(buf), new Date().toISOString()).run();
  return json({ ok: true });
});

export const onRequestDelete = handle(async ({ request, env }) => {
  const { id, idx } = await target(request, env);
  await env.DB.prepare("DELETE FROM activity_photos WHERE activity_id=?1 AND idx=?2").bind(id, idx).run();
  return json({ ok: true });
});
