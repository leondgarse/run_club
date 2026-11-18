// Add / edit an activity in My log (TJH/SJH, /api/activities), with up to 3 screenshots (/api/actphoto) that are
// each read by /api/extract and merged into the form. Opened from My log, or from a plan session (linked: week+item).
import { S, doneSet, dataChanged, parseExtra } from "../../utils/state.js";
import { api, download } from "../../utils/api.js";
import { t } from "../../utils/i18n.js";
import { normTime, autoPace, todayIso } from "../../utils/dates.js";
import { pick, prepare } from "../../utils/image.js";

const toast = (title) => wx.showToast({ title: String(title).slice(0, 60), icon: "none", duration: 2600 });
const MAX_SHOTS = 3;
const TYPES = ["run", "gym", "swim", "bike", "hike", "other"];
const TYPE_LABEL = { run: "Run", gym: "Gym", swim: "Swim", bike: "Bike", hike: "Hike / walk", other: "Other" };
// Same keys as public/app.js EXTRA_FIELDS (the server validates them): [key, label, unit, placeholder, input type, full width]
const EXTRA_FIELDS = [
  ["max_hr", "Max HR", "bpm", "176", "number"],
  ["vert_osc_cm", "Vertical oscillation", "cm", "8.2", "digit"],
  ["stride_m", "Avg stride", "m", "1.01", "digit"],
  ["gct_ms", "Ground contact", "ms", "245", "number"],
  ["lr_balance", "L/R balance", "left %", "49.8", "digit"],
  ["power_w", "Avg power", "W", "180", "number"],
  ["elev_m", "Elevation gain", "m", "12", "number"],
  ["training_load", "Training load", "", "120", "number"],
  ["start", "Start time", "hh:mm", "06:30", "text"],
  ["weather", "Weather", "", "28°C humid", "text", false, 30],
  ["splits", "Km splits", "", "5:45 5:40 5:38", "text", true, 200],
  ["split_hr", "Split HR", "", "150 156 160", "text", true, 120],
];
const shotUrl = (p, id, idx) => `/api/actphoto?person=${p}&id=${id}&idx=${idx}`;

Page({
  data: {},
  onLoad(q) {
    const p = q.p;
    let a = null, link = null, prefill = null, shots = [];
    if (q.handoff && S.handoff) { ({ activity: a = null, link = null, prefill = null, shots = [] } = S.handoff); S.handoff = null; }
    else if (q.id) a = S.hist.get(p)?.activities.find((x) => String(x.id) === q.id) || null;
    Object.assign(this, { p, id: a?.id || null, link: link || (a?.week && a?.item ? { week: a.week, item: a.item } : null),
      paceTouched: !!a?.pace, busy: false, filled: new Set(),
      shots: a?.photo_idx ? String(a.photo_idx).split(",").map((i) => ({ idx: Number(i), existing: true })) : [] });
    const v = a || prefill || {};
    const x = parseExtra(v);
    const extra = EXTRA_FIELDS.map(([k, label, unit, ph, type, full, max]) => ({ k, label: t(label), unit: t(unit), ph, type, full: !!full, max: max || 20, v: x[k] ?? "" }));
    wx.setNavigationBarTitle({ title: t(this.id ? "Edit activity" : "New activity") });
    this.setData({
      head: `${p} · ${t(this.id ? "Edit activity" : "New activity")}${this.link ? ` · ✓ ${t("plan session")}` : ""}`,
      date: v.date || todayIso(), today: todayIso(), typeIdx: Math.max(0, TYPES.indexOf(v.type || "run")),
      types: TYPES.map((k) => t(TYPE_LABEL[k])), lockType: !!this.link,
      title: v.title || "", km: v.km ?? "", time: v.duration || "", pace: v.pace || "", hr: v.hr ?? "", cad: v.cadence ?? "", note: v.note || "",
      extra, more: extra.some((f) => f.v !== ""), canDelete: !!this.id, flash: {},
      L: { date: t("Date"), type: t("Type"), title: t("Title"), optional: t("optional"), distance: t("Distance"), time: t("Time"),
        pace: t("Avg pace"), hr: t("Avg HR"), cad: t("Cadence"), note: t("Note"), feel: t("How did it feel? Splits, weather…"),
        additional: t("Additional"), xhint: t("Running form and other watch details. They make the daily suggestion more specific."),
        del: t("Delete"), save: t("Save"), reading: t("Reading…") },
    });
    this.extraCount();
    this.renderShots();
    if (shots.length) this.addShots(shots);
  },

  onInput(e) {
    const f = e.currentTarget.dataset.f, v = e.detail.value;
    const d = { [f]: v };
    if (f === "pace") this.paceTouched = !!v;
    if ((f === "km" || f === "time") && !this.paceTouched) d.pace = autoPace(f === "km" ? v : this.data.km, f === "time" ? v : this.data.time);
    this.setData(d);
  },
  onDate(e) { this.setData({ date: e.detail.value }); },
  onType(e) { this.setData({ typeIdx: Number(e.detail.value) }); },
  onExtra(e) { this.setData({ [`extra[${e.currentTarget.dataset.i}].v`]: e.detail.value }); this.extraCount(); },
  toggleMore() { this.setData({ more: !this.data.more }); },
  blurTime() { const v = normTime(this.data.time); if (v) this.setData({ time: v }); },
  extraCount() {
    const n = this.data.extra.filter((f) => String(f.v).trim()).length;
    this.setData({ extraN: n ? t("{n} filled", { n }) : t("optional") });
  },

  // ── screenshots ──
  renderShots() {
    const live = this.shots.filter((x) => !x.removed);
    for (const x of live) if (x.existing && !x.path && !x.loading) this.loadShot(x);
    this.setData({
      shots: this.shots.map((x, i) => ({ i, src: x.path || "", reading: !!x.reading, removed: !!x.removed })).filter((x) => !x.removed),
      addLabel: live.length >= MAX_SHOTS ? "" : t(live.length ? "+ Add screenshot ({n}/{m})" : "📷 Pick or paste watch screenshots (up to {m})", { n: live.length, m: MAX_SHOTS }),
    });
  },
  async loadShot(x) {
    x.loading = true;
    try { x.path = await download(shotUrl(this.p, this.id, x.idx)); } catch {}
    this.renderShots();
  },
  async pickShots() {
    const room = MAX_SHOTS - this.shots.filter((x) => !x.removed).length;
    if (room > 0) this.addShots(await pick(room));
  },
  async addShots(paths) {
    const room = MAX_SHOTS - this.shots.filter((x) => !x.removed).length;
    if (paths.length > room) toast(t("Up to {m} screenshots per activity", { m: MAX_SHOTS }));
    const added = [];
    for (const src of paths.slice(0, Math.max(room, 0))) {
      try { const img = await prepare(src); const sh = { ...img, reading: true }; this.shots.push(sh); added.push(sh); }
      catch (e) { toast(e.message); }
    }
    this.renderShots();
    for (const sh of added) { await this.readShot(sh); sh.reading = false; this.renderShots(); } // one at a time (rate limits)
  },
  removeShot(e) {
    const x = this.shots[Number(e.currentTarget.dataset.i)];
    if (!x) return;
    if (x.existing) x.removed = true; else this.shots.splice(this.shots.indexOf(x), 1);
    this.renderShots();
  },
  async readShot(sh) {
    try {
      const r = await api(`/api/extract?person=${this.p}`, { method: "POST", data: sh.data, header: { "content-type": sh.mime } });
      const d = {}, flash = {};
      // A field one screenshot filled isn't overwritten by the next (screens repeat summary values, often rounded).
      const set = (f, v) => { if (v == null || v === "" || this.filled.has(f)) return; d[f] = v; flash[f] = true; this.filled.add(f); };
      set("date", r.date && r.date <= todayIso() && !this.link ? r.date : null);
      if (!this.link && TYPES.includes(r.type) && !this.filled.has("type")) { d.typeIdx = TYPES.indexOf(r.type); this.filled.add("type"); flash.type = true; }
      set("km", r.km); set("time", r.duration);
      if (!String(this.data.title).trim()) set("title", r.title);
      set("hr", r.hr); set("cad", r.cadence);
      let nx = 0;
      this.data.extra.forEach((f, i) => {
        const v = r.extra?.[f.k];
        if (v == null || v === "" || this.filled.has(`x_${f.k}`)) return;
        d[`extra[${i}].v`] = v; flash[`x_${f.k}`] = true; this.filled.add(`x_${f.k}`); nx++;
      });
      if (nx) d.more = true;
      if (r.pace && !this.filled.has("pace")) { d.pace = r.pace; flash.pace = true; this.filled.add("pace"); this.paceTouched = true; }
      else if (!this.paceTouched) d.pace = autoPace(d.km ?? this.data.km, d.time ?? this.data.time);
      this.setData({ ...d, flash });
      setTimeout(() => this.setData({ flash: {} }), 1800);
      this.extraCount();
      const n = Object.keys(flash).length;
      const notes = (r.notes || []).map((x) => t(x)).join("; ");
      toast(n ? t("Filled {n} fields — check & Save", { n }) + (notes ? ` (${notes})` : "") : t("No new stats in that screenshot"));
    } catch (e) { toast(e.message); }
  },
  /** After the activity is saved: delete removed photos, upload new ones into free slots. */
  async syncShots(a) {
    const used = new Set(), jobs = [];
    for (const x of this.shots) {
      if (x.existing && x.removed) jobs.push(api(shotUrl(this.p, a.id, x.idx), { method: "DELETE" }));
      else if (x.existing) used.add(x.idx);
    }
    for (const x of this.shots.filter((y) => !y.existing && !y.removed)) {
      const idx = [0, 1, 2].find((i) => !used.has(i));
      if (idx == null) break;
      used.add(idx);
      jobs.push(api(shotUrl(this.p, a.id, idx), { method: "PUT", data: x.data, header: { "content-type": x.mime } }));
    }
    const res = await Promise.all(jobs.map((j) => j.then(() => true, () => false)));
    if (res.includes(false)) toast(t("Saved, but a screenshot didn't upload"));
    return { ...a, photo_idx: [...used].sort().join(",") || null };
  },

  async save() {
    if (this.busy) return;
    const duration = normTime(this.data.time);
    const pace = normTime(this.data.pace, { pace: true });
    const km = String(this.data.km).trim().replace(",", ".");
    if (km && !(parseFloat(km) > 0)) return toast(t("Distance should be a number of km"));
    if (duration === null) return toast(t("Time should look like 32:10 or 1:02:30"));
    if (pace === null) return toast(t("Pace should look like 5:40"));
    this.busy = true;
    wx.showLoading({ title: t("Saving…"), mask: true });
    try {
      const r = await api("/api/activities", { method: "POST", data: {
        person: this.p, id: this.id, date: this.data.date, type: TYPES[this.data.typeIdx], title: String(this.data.title).trim(),
        km, duration, pace, hr: String(this.data.hr).trim(), cadence: String(this.data.cad).trim(), note: String(this.data.note).trim(),
        extra: Object.fromEntries(this.data.extra.map((f) => [f.k, String(f.v).trim()]).filter(([, v]) => v)),
        week: this.link?.week || null, item: this.link?.item || null,
      } });
      if (r.row) { S.logs.set(`${this.p}|${r.row.week}|${r.row.item}`, r.row); doneSet(this.p, r.row.week).add(r.row.item); }
      const activity = await this.syncShots(r.activity);
      const h = S.hist.get(this.p) || { activities: [], logs: [], ready: true };
      h.activities = [activity, ...h.activities.filter((a) => a.id !== activity.id)]
        .sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : b.id - a.id));
      S.hist.set(this.p, h);
      dataChanged(this.p);
      wx.hideLoading();
      toast(t("Saved ✓"));
      wx.navigateBack();
    } catch (e) {
      wx.hideLoading();
      toast(t("Couldn't save: {e}", { e: e.message }));
    }
    this.busy = false;
  },
  del() {
    if (!this.id) return;
    wx.showModal({ content: t("Delete this activity?"), success: async ({ confirm }) => {
      if (!confirm) return;
      try {
        await api(`/api/activities?person=${this.p}&id=${this.id}`, { method: "DELETE" });
        const h = S.hist.get(this.p);
        if (h) h.activities = h.activities.filter((a) => a.id !== this.id);
        dataChanged(this.p);
        wx.navigateBack();
      } catch (e) { toast(t("Couldn't delete: {e}", { e: e.message })); }
    } });
  },
});
