// /api/photo?person=&week=&item=
//   GET    -> the image
//   PUT    raw image body (jpeg/png/webp, ≤ 1.5 MB; the app resizes before upload)
//   DELETE -> removes it
import { HttpError, fromB64, fromQuery, handle, json, key, toB64 } from "../../lib/shared.js";

const MAX = 1.5 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const onRequestGet = handle(async ({ request, env }) => {
  const k = key(fromQuery(request));
  const row = await env.DB.prepare("SELECT mime, data FROM photos WHERE person=?1 AND week=?2 AND item=?3")
    .bind(k.person, k.week, k.item).first();
  if (!row) throw new HttpError(404, "no photo");
  return new Response(fromB64(row.data), {
    headers: { "content-type": row.mime, "cache-control": "private, max-age=86400" },
  });
});

export const onRequestPut = handle(async ({ request, env }) => {
  const k = key(fromQuery(request));
  const mime = (request.headers.get("content-type") || "").split(";")[0];
  if (!TYPES.has(mime)) throw new HttpError(415, "unsupported image type");
  const buf = await request.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > MAX) throw new HttpError(413, "image too large");

  const done = await env.DB.prepare("SELECT 1 FROM progress WHERE person=?1 AND week=?2 AND item=?3")
    .bind(k.person, k.week, k.item).first();
  if (!done) throw new HttpError(409, "mark the session done first");

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO photos (person, week, item, mime, data, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) " +
      "ON CONFLICT(person, week, item) DO UPDATE SET mime=excluded.mime, data=excluded.data, created_at=excluded.created_at"
    ).bind(k.person, k.week, k.item, mime, toB64(buf), now),
    env.DB.prepare("UPDATE progress SET has_photo=1, updated_at=?4 WHERE person=?1 AND week=?2 AND item=?3")
      .bind(k.person, k.week, k.item, now),
  ]);
  return json({ ok: true, updated_at: now });
});

export const onRequestDelete = handle(async ({ request, env }) => {
  const k = key(fromQuery(request));
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM photos WHERE person=?1 AND week=?2 AND item=?3").bind(k.person, k.week, k.item),
    env.DB.prepare("UPDATE progress SET has_photo=0, updated_at=?4 WHERE person=?1 AND week=?2 AND item=?3")
      .bind(k.person, k.week, k.item, now),
  ]);
  return json({ ok: true, updated_at: now });
});
