// EN / 中文 for the mini program. The site's dictionary (shared/i18n-zh.js, copied from public/ by
// scripts/mp-sync.sh) plus a few strings that only exist here. Theme follows the system (app.json darkmode).
import { ZH } from "../shared/i18n-zh.js";

const MP_ZH = {
  "Sign in": "登录", "Who are you?": "你是谁？", "Sign-in failed: {e}": "登录失败：{e}",
  "Pick your name and enter the Run Club passcode. You only need to do this once on this WeChat account.":
    "选择你的名字并输入 Run Club 密码。这个微信号只需要做一次。",
  "Pick your name first": "请先选择名字", "Signing in…": "正在登录…",
  "Add a photo": "添加照片", "Choose": "选择", "Pull down to refresh": "下拉刷新",
};

const sysLang = () => { try { return wx.getAppBaseInfo().language || ""; } catch { return ""; } };
let lang = (() => { try { return wx.getStorageSync("lang"); } catch { return ""; } })() || (/^zh/i.test(sysLang()) ? "zh" : "en");

export const currentLang = () => lang;
export function setLang(v) { lang = v; try { wx.setStorageSync("lang", v); } catch {} }
export function t(s, vars) {
  let out = lang === "zh" ? (MP_ZH[s] ?? ZH[s] ?? s) : s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
  return out;
}
/** Kinds like "Easy · L2": translate the part before the dot. */
export const tKind = (k) => { const [a, ...rest] = String(k).split(" · "); return [t(a), ...rest].join(" · "); };
/** A suggestion object in the current language (Claude stores a `zh` copy next to the English fields). */
export const localized = (s) => (s && lang === "zh" && s.zh ? { ...s, ...s.zh } : s);
