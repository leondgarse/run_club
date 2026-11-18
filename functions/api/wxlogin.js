// WeChat mini program sign-in (miniprogram/, see docs/wechat-miniprogram.md).
//   POST /api/wxlogin { code }                     -> { token, person, expires_at }  (WeChat user already bound)
//                                                  -> 401 { error, bind: true }       (not bound yet)
//   POST /api/wxlogin { code, passcode, person }   -> binds this WeChat user to a runner, then as above
// code: from wx.login() in the mini program; exchanged for the openid with jscode2session (WX_APPID / WX_SECRET
// secrets). The returned token goes in "Authorization: Bearer …" and is valid for 30 days; only its hash is stored.
import { HttpError, PEOPLE, handle, json, passcodeOk, sha256Hex } from "../../lib/shared.js";

const DAYS = 30;

async function openidFor(env, code) {
  if (!env.WX_APPID || !env.WX_SECRET) throw new HttpError(503, "WeChat sign-in is not set up (WX_APPID / WX_SECRET)");
  const u = new URL("https://api.weixin.qq.com/sns/jscode2session");
  u.search = new URLSearchParams({ appid: env.WX_APPID, secret: env.WX_SECRET, js_code: code, grant_type: "authorization_code" });
  const res = await fetch(u);
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.errcode || !d.openid) throw new HttpError(401, `WeChat sign-in failed (${d.errcode || res.status})`);
  return d.openid;
}

export const onRequestPost = handle(async ({ request, env }) => {
  const body = await request.json().catch(() => ({}));
  const code = String(body.code || "");
  if (!/^[\w-]{8,128}$/.test(code)) throw new HttpError(400, "bad code");
  const openid = await openidFor(env, code);
  const now = new Date();

  let user = await env.DB.prepare("SELECT person FROM wx_users WHERE openid=?1").bind(openid).first();
  if (!user) {
    if (body.passcode == null) return json({ error: "not bound", bind: true }, 401);
    if (!PEOPLE.has(body.person)) throw new HttpError(400, "bad person");
    if (!passcodeOk(env, body.passcode)) return json({ error: "wrong passcode", bind: true }, 401);
    await env.DB.prepare("INSERT INTO wx_users (openid, person, created_at) VALUES (?1, ?2, ?3) " +
      "ON CONFLICT(openid) DO UPDATE SET person=excluded.person").bind(openid, body.person, now.toISOString()).run();
    user = { person: body.person };
  }

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const expires = new Date(now.getTime() + DAYS * 864e5).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM wx_sessions WHERE expires_at <= ?1").bind(now.toISOString()),
    env.DB.prepare("INSERT INTO wx_sessions (token_hash, openid, expires_at) VALUES (?1, ?2, ?3)")
      .bind(await sha256Hex(token), openid, expires),
  ]);
  return json({ token, person: user.person, expires_at: expires });
});
