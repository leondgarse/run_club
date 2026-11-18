// Requests to the Run Club API with a WeChat session token (functions/api/wxlogin.js).
// First run: wx.login → /api/wxlogin. If this WeChat user isn't bound to a runner yet, go to the sign-in page
// (passcode + name, once). A 401 later (token expired) signs in again silently.
import { API_BASE } from "../config.js";

const get = (k) => { try { return wx.getStorageSync(k) || ""; } catch { return ""; } };
const set = (k, v) => { try { wx.setStorageSync(k, v); } catch {} };
export const me = () => get("me");

const call = (fn, opts) => new Promise((resolve, reject) => fn({ ...opts, success: resolve, fail: reject }));
const errOf = (r) => new Error((r.data && r.data.error) || `HTTP ${r.statusCode}`);

let signing = null;
/** wx.login → token. With {passcode, person} it also binds this WeChat user (sign-in page). */
export async function signIn(bind) {
  const { code } = await call(wx.login, {});
  const r = await call(wx.request, { url: `${API_BASE}/api/wxlogin`, method: "POST", data: { code, ...(bind || {}) } });
  if (r.statusCode === 200) { set("token", r.data.token); set("me", r.data.person); return r.data; }
  const e = errOf(r); e.bind = !!(r.data && r.data.bind); throw e;
}
async function token(fresh) {
  if (!fresh && get("token")) return get("token");
  signing = signing || signIn().finally(() => { signing = null; });
  try { await signing; } catch (e) {
    if (e.bind) wx.reLaunch({ url: "/pages/login/login" });
    throw e;
  }
  return get("token");
}

/** JSON API call. opts: { method, data (object or ArrayBuffer), header } → parsed body; throws Error(message). */
export async function api(path, { method = "GET", data, header = {} } = {}) {
  let tok = await token(false);
  for (let i = 0; i < 2; i++) {
    const r = await call(wx.request, { url: API_BASE + path, method, data, header: { authorization: `Bearer ${tok}`, ...header } });
    if (r.statusCode === 401 && i === 0) { tok = await token(true); continue; }
    if (r.statusCode < 200 || r.statusCode >= 300) throw errOf(r);
    return r.data;
  }
  throw new Error("unauthorized");
}

/** A stored photo (needs the token, so not an <image src>): downloads it and returns a local temp path. */
export async function download(path) {
  let tok = await token(false);
  for (let i = 0; i < 2; i++) {
    const r = await call(wx.downloadFile, { url: API_BASE + path, header: { authorization: `Bearer ${tok}` } });
    if (r.statusCode === 401 && i === 0) { tok = await token(true); continue; }
    if (r.statusCode !== 200) throw new Error(`HTTP ${r.statusCode}`);
    return r.tempFilePath;
  }
  throw new Error("unauthorized");
}

/** WGW's public summary (static file, no token). */
export async function getStatic(path) {
  const r = await call(wx.request, { url: API_BASE + path });
  if (r.statusCode !== 200) throw errOf(r);
  return r.data;
}
