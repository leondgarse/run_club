// A ticked plan session's details (/api/progress log). WGW: one photo (/api/photo) + ✨ read it.
// TJH/SJH: screenshots and full details live in My log (an activity linked to this session; pages/act).
import { S, SELF_LOG, planFor, doneSet, logOf, dataChanged, linkedAct } from "../../utils/state.js";
import { api, download } from "../../utils/api.js";
import { t, tKind } from "../../utils/i18n.js";
import { DAYS, normTime, autoPace, iso, addDays, fromIso } from "../../utils/dates.js";
import { pick, prepare } from "../../utils/image.js";

const toast = (title) => wx.showToast({ title: String(title).slice(0, 60), icon: "none", duration: 2600 });
const qsKey = (p, w, i) => `person=${p}&week=${w}&item=${encodeURIComponent(i)}`;

Page({
  data: {},
  onLoad(q) {
    const { p, w, item } = q;
    const it = planFor(p, w).items?.find((i) => i.id === item);
    if (!it) { wx.navigateBack(); return; }
    Object.assign(this, { p, w, item, it, paceTouched: false, busy: false });
    const l = logOf(p, w, item) || {};
    this.paceTouched = !!l.pace;
    wx.setNavigationBarTitle({ title: `${p} · ${t(DAYS[it.dayIndex])}` });
    this.setData({
      kind: `${p} · ${t(DAYS[it.dayIndex])} · ${tKind(it.kind)}`, color: it.color || "var(--mute)", title: it.title,
      km: l.km ?? "", time: l.duration ?? "", pace: l.pace ?? "", hr: l.hr ?? "", note: l.note ?? "",
      L: { distance: t("Distance"), time: t("Time"), pace: t("Avg pace"), hr: t("Avg HR"), note: t("Note"), feel: t("How did it feel?"),
        untick: t("Un-tick"), save: t("Save"), addPhoto: t("📷 Add photo or watch screenshot"), fill: t("✨ Fill from screenshot"),
        remove: t("Remove"), loading: t("Loading photo…"),
        linked: t("📋 Full details & screenshots (in My log)"), shots: t("📷 Screenshots (up to 3) → full details in My log"),
        noShot: t("Full details without a screenshot") },
    });
    this.renderPhoto();
  },
  onInput(e) {
    const f = e.currentTarget.dataset.f, v = e.detail.value;
    const d = { [f]: v };
    if (f === "pace") this.paceTouched = !!v;
    if ((f === "km" || f === "time") && !this.paceTouched) d.pace = autoPace(f === "km" ? v : this.data.km, f === "time" ? v : this.data.time);
    this.setData(d);
  },
  blurTime() { const v = normTime(this.data.time); if (v) this.setData({ time: v }); },
  blurPace() { const v = normTime(this.data.pace, { pace: true }); if (v) this.setData({ pace: v }); },

  async renderPhoto() {
    const { p, w, item } = this;
    const l = logOf(p, w, item) || {};
    const self = SELF_LOG.has(p);
    const photo = { has: !!l.has_photo, self, linked: self && !!linkedAct(p, w, item), src: "" };
    this.setData({ photo });
    if (!l.has_photo) return;
    try {
      const src = await download(`/api/photo?${qsKey(p, w, item)}&v=${encodeURIComponent(l.updated_at || "")}`);
      this.setData({ "photo.src": src });
    } catch { this.setData({ "photo.err": t("Photo unavailable") }); }
  },
  async addPhoto() {
    const [src] = await pick(1);
    if (!src) return;
    const { p, w, item } = this;
    wx.showLoading({ title: t("Uploading…") });
    try {
      const img = await prepare(src);
      const r = await api(`/api/photo?${qsKey(p, w, item)}`, { method: "PUT", data: img.data, header: { "content-type": img.mime } });
      const l = logOf(p, w, item) || { person: p, week: w, item };
      S.logs.set(`${p}|${w}|${item}`, { ...l, has_photo: 1, updated_at: r.updated_at });
      wx.hideLoading();
      await this.renderPhoto();
      toast(t("Photo saved — tap ✨ to read stats from it"));
    } catch (e) { wx.hideLoading(); toast(t("Upload failed: {e}", { e: e.message })); }
  },
  async removePhoto() {
    const { p, w, item } = this;
    try {
      const r = await api(`/api/photo?${qsKey(p, w, item)}`, { method: "DELETE" });
      S.logs.set(`${p}|${w}|${item}`, { ...logOf(p, w, item), has_photo: 0, updated_at: r.updated_at });
      this.renderPhoto();
    } catch (e) { toast(t("Couldn't remove: {e}", { e: e.message })); }
  },
  async extract() {
    const { p, w, item } = this;
    wx.showLoading({ title: t("Reading…") });
    try {
      const r = await api("/api/extract", { method: "POST", data: { person: p, week: w, item } });
      const d = {}, got = [];
      if (r.km != null) { d.km = r.km; got.push("distance"); }
      if (r.duration) { d.time = r.duration; got.push("time"); }
      if (r.hr != null) { d.hr = r.hr; got.push("HR"); }
      if (r.pace) { d.pace = r.pace; this.paceTouched = true; got.push("pace"); }
      else if (!this.paceTouched) d.pace = autoPace(d.km ?? this.data.km, d.time ?? this.data.time);
      this.setData(d);
      wx.hideLoading();
      toast(got.length ? t("Filled {f} — check & Save", { f: got.map((g) => t(g)).join(", ") }) : t("Couldn't find stats in that image"));
    } catch (e) { wx.hideLoading(); toast(e.message); }
  },

  /** TJH/SJH: open Add activity linked to this session, prefilled from the plan and the quick fields here. */
  async details(e) {
    const shots = e.currentTarget.dataset.shots ? await pick(3) : [];
    if (e.currentTarget.dataset.shots && !shots.length) return;
    const { p, w, item, it } = this;
    const quick = { km: String(this.data.km).trim(), duration: normTime(this.data.time) || "", pace: String(this.data.pace).trim(),
      hr: String(this.data.hr).trim(), note: String(this.data.note).trim() };
    const a = linkedAct(p, w, item);
    const type = /strength/i.test(it.kind) ? "gym" : /swim/i.test(it.kind) ? "swim" : "run";
    S.handoff = a
      ? { activity: { ...a, ...Object.fromEntries(Object.entries(quick).filter(([, v]) => v)) }, shots }
      : { link: { week: w, item }, shots, prefill: { date: iso(addDays(fromIso(w), it.dayIndex)), type,
          title: it.title.replace(/[^\p{L}\p{N} .,:;'’()+\-–—/×%°·~&!?]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40), ...quick } };
    wx.redirectTo({ url: `/pages/act/act?p=${p}&handoff=1` });
  },

  async save() {
    if (this.busy) return;
    const { p, w, item } = this;
    const km = String(this.data.km).trim().replace(",", ".");
    const duration = normTime(this.data.time);
    const pace = normTime(this.data.pace, { pace: true });
    const hr = String(this.data.hr).trim();
    if (km && !(parseFloat(km) > 0)) return toast(t("Distance should be a number of km"));
    if (duration === null) return toast(t("Time should look like 32:10 or 1:02:30"));
    if (pace === null) return toast(t("Pace should look like 5:40"));
    if (hr && !(+hr >= 40 && +hr <= 230)) return toast(t("Heart rate should be 40–230"));
    this.busy = true;
    try {
      const r = await api("/api/progress", { method: "POST",
        data: { person: p, week: w, item, done: true, log: { km, duration, pace, hr, note: String(this.data.note).trim() } } });
      doneSet(p, w).add(item);
      S.logs.set(`${p}|${w}|${item}`, r.row);
      dataChanged(p);
      toast(t("Saved ✓"));
      wx.navigateBack();
    } catch (e) { toast(t("Couldn't save: {e}", { e: e.message })); }
    this.busy = false;
  },
  untick() {
    const { p, w, item } = this;
    const l = logOf(p, w, item);
    const go = async () => {
      try {
        await api("/api/progress", { method: "POST", data: { person: p, week: w, item, done: false } });
        doneSet(p, w).delete(item);
        S.logs.delete(`${p}|${w}|${item}`);
        dataChanged(p);
        wx.navigateBack();
      } catch { toast(t("Couldn't save — check your connection")); }
    };
    if (l?.km || l?.duration || l?.hr || l?.note || l?.has_photo) {
      wx.showModal({ content: t("Un-tick this session? Its logged details and photo will be removed."), success: (r) => r.confirm && go() });
    } else go();
  },
});
