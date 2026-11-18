// Target line at the top of a runner's tab (/api/goal). Max/resting HR only for TJH/SJH: WGW's health data stays off the site.
import { S, dataChanged } from "../../utils/state.js";
import { api } from "../../utils/api.js";
import { t } from "../../utils/i18n.js";
import { todayIso } from "../../utils/dates.js";

const GOAL_RE = /^[A-Za-z0-9 .,:;'’()+\-–—/&!?#]*$/, GOAL_MAX = 60; // lib/rules.js TEXT_RULES.goal

Page({
  data: {},
  onLoad(q) {
    const p = q.p, g = S.goals[p] || {};
    wx.setNavigationBarTitle({ title: t("Target") });
    this.p = p;
    this.setData({
      p, text: g.text || "", date: g.date || "", maxHr: g.max_hr ?? "", restHr: g.rest_hr ?? "", hr: p !== "WGW", canClear: !!g.text,
      today: todayIso(), busy: false,
      L: { target: t("Target"), english: t("English, up to 60 characters (中文 is made automatically)"), date: t("Race date"),
        optional: t("optional"), maxHr: t("Max HR"), restHr: t("Resting HR"), clear: t("Clear"), save: t("Save"), choose: t("Choose"),
        hint: t("Optional. Max HR from a race or hard test (blank = highest logged); resting HR first thing in the morning. They set your easy heart-rate ceiling.") },
    });
  },
  onInput(e) { this.setData({ [e.currentTarget.dataset.f]: e.detail.value }); },
  clearDate() { this.setData({ date: "" }); },
  save() { this.send(false); },
  clear() { this.send(true); },
  async send(clear) {
    const p = this.p;
    const text = clear ? "" : String(this.data.text).replace(/\s+/g, " ").trim();
    if (text.length > GOAL_MAX || !GOAL_RE.test(text)) return wx.showToast({ title: t("Target: English letters, digits and basic punctuation, up to 60 characters"), icon: "none", duration: 3000 });
    this.setData({ busy: true });
    try {
      const hr = p === "WGW" ? {} : { max_hr: String(this.data.maxHr).trim() || null, rest_hr: String(this.data.restHr).trim() || null };
      const r = await api("/api/goal", { method: "POST", data: { person: p, text, date: clear ? null : this.data.date || null, ...hr } });
      S.goals[p] = r.goal;
      if (p !== "WGW") dataChanged(p);
      wx.showToast({ title: t("Saved ✓"), icon: "none" });
      wx.navigateBack();
    } catch (e) {
      wx.showToast({ title: e.message, icon: "none", duration: 3000 });
      this.setData({ busy: false });
    }
  },
});
