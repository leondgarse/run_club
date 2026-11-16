// Shared passcode for every /api/* route. Set it with: wrangler pages secret put PASSCODE
import { json } from "../../lib/shared.js";

function same(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < b.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function onRequest({ request, env, next }) {
  if (env.PASSCODE && !same(request.headers.get("x-passcode") || "", env.PASSCODE)) {
    return json({ error: "unauthorized" }, 401);
  }
  return next();
}
