// Every /api/* route needs the shared passcode (x-passcode header; set it with: wrangler pages secret put PASSCODE)
// or a WeChat mini program session token (Authorization: Bearer …, from /api/wxlogin).
// /api/wxlogin itself is open: it checks the WeChat login code, and the passcode when binding a new WeChat user.
import { json, passcodeOk, wxSession } from "../../lib/shared.js";

export async function onRequest({ request, env, next }) {
  if (new URL(request.url).pathname === "/api/wxlogin") return next();
  if (passcodeOk(env, request.headers.get("x-passcode"))) return next();
  if (await wxSession(env, request).catch(() => null)) return next();
  return json({ error: "unauthorized" }, 401);
}
