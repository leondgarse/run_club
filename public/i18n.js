// UI language (EN / 中文) and theme (auto / light / dark). Both are per-device settings in localStorage.
// t("English text", {vars}) returns the Chinese string when 中文 is on; anything missing falls back to English.
// Plan content (session titles from plans.js) is shown as written; kinds and day names are translated.

import { ZH } from "./i18n-zh.js";

const KEY_LANG = "lang", KEY_THEME = "theme";
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

export let lang = read(KEY_LANG) || (/^zh/i.test(navigator.language || "") ? "zh" : "en");
export let theme = read(KEY_THEME) || "auto";


export function t(s, vars) {
  let out = lang === "zh" && ZH[s] != null ? ZH[s] : s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
  return out;
}
/** Kinds like "Easy · L2" or "Strength · L1": translate the part before the dot. */
export const tKind = (k) => { const [a, ...rest] = String(k).split(" · "); const tr = t(a); return [tr, ...rest].join(" · "); };
/** A suggestion object in the current language (Claude stores a `zh` copy next to the English fields). */
export const localized = (s) => (s && lang === "zh" && s.zh ? { ...s, ...s.zh } : s);

/** Static text in index.html: data-i18n="key" (text), data-i18n-ph (placeholder), data-i18n-aria (aria-label). */
export function applyStatic(root = document) {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.dataset.i18nSrc ??= el.dataset.i18n;
    el.textContent = t(el.dataset.i18nSrc);
  });
  root.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  root.querySelectorAll("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
}

export const currentLang = () => lang;
export const currentTheme = () => theme;
export function setLang(v) { lang = v; write(KEY_LANG, v); applyStatic(); }

const mq = window.matchMedia?.("(prefers-color-scheme: light)");
export function applyTheme() {
  const eff = theme === "auto" ? (mq?.matches ? "light" : "dark") : theme;
  document.documentElement.dataset.theme = eff;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", eff === "light" ? "#f4f5f7" : "#0f1115");
}
export function setTheme(v) { theme = v; write(KEY_THEME, v); applyTheme(); }
mq?.addEventListener?.("change", () => theme === "auto" && applyTheme());
applyTheme();
