// POST /api/extract { person, week, item }      -> { km, duration, pace, hr, cadence, date, type, title, extra, notes }
// POST /api/extract?person=X  (raw image body)  -> same, for the "Add activity" form (pasted/picked; not stored)
// The vision model (lib/shared.js ai()) transcribes the screenshot; lib/screenshot.js maps labels to fields and cross-checks them.
import { HttpError, PEOPLE, fromQuery, handle, json, key, ai, toB64 } from "../../lib/shared.js";
import { PROMPT, mapTranscription } from "../../lib/screenshot.js";

export const onRequestPost = handle(async ({ request, env }) => {
  let photo;
  const mime = (request.headers.get("content-type") || "").split(";")[0];
  if (mime.startsWith("image/")) {
    if (!PEOPLE.has(fromQuery(request).person)) throw new HttpError(400, "bad person");
    if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new HttpError(415, "unsupported image type");
    const buf = await request.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > 1.5 * 1024 * 1024) throw new HttpError(413, "image too large");
    photo = { mime, data: toB64(buf) };
  } else {
    const body = await request.json().catch(() => ({}));
    const k = key(body);
    photo = await env.DB.prepare("SELECT mime, data FROM photos WHERE person=?1 AND week=?2 AND item=?3")
      .bind(k.person, k.week, k.item).first();
    if (!photo) throw new HttpError(404, "no photo for this session");
  }

  const text = await ai(env, [{
    role: "user",
    content: [
      { type: "text", text: PROMPT },
      { type: "image_url", image_url: { url: `data:${photo.mime};base64,${photo.data}` } },
    ],
  }], { json: true, maxTokens: 6000, temperature: 0, think: true });

  let r;
  try { r = JSON.parse(text.replace(/^```(json)?|```$/g, "").trim()); } catch { throw new HttpError(502, "couldn't read the image"); }
  const today = new Date(Date.now() + 14 * 3600e3).toISOString().slice(0, 10); // latest local date (UTC+14) for the future-date check
  return json(mapTranscription(r, today));
});
