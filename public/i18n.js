// UI language (EN / 中文) and theme (auto / light / dark). Both are per-device settings in localStorage.
// t("English text", {vars}) returns the Chinese string when 中文 is on; anything missing falls back to English.
// Plan content (session titles from plans.js) is shown as written; kinds and day names are translated.

const KEY_LANG = "lang", KEY_THEME = "theme";
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

export let lang = read(KEY_LANG) || (/^zh/i.test(navigator.language || "") ? "zh" : "en");
export let theme = read(KEY_THEME) || "auto";

const ZH = {
  // header / tabs / week
  "This week": "本周", "Last week": "上周", "Next week": "下周", "Tap for this week": "点击回到本周",
  "📊 All": "📊 全部", "Today": "今天", "Week of {d}": "{d} 这周",
  "Previous week": "上一周", "Next week ›": "下一周", "Jump to this week": "回到本周",
  "Settings": "设置", "Language": "语言", "Theme": "主题", "Auto": "跟随系统", "Light": "浅色", "Dark": "深色", "Done": "完成",
  // days / months
  "Mon": "周一", "Tue": "周二", "Wed": "周三", "Thu": "周四", "Fri": "周五", "Sat": "周六", "Sun": "周日",
  "Jan": "1月", "Feb": "2月", "Mar": "3月", "Apr": "4月", "May": "5月", "Jun": "6月",
  "Jul": "7月", "Aug": "8月", "Sep": "9月", "Oct": "10月", "Nov": "11月", "Dec": "12月",
  // plan kinds
  "Easy": "轻松跑", "Long": "长距离", "Long · Easy": "长距离 · 轻松", "Tempo": "节奏跑", "Threshold": "乳酸阈",
  "Interval": "间歇跑", "Repetition": "重复跑", "Goal pace": "目标配速", "Test": "测试", "Race": "比赛",
  "Rest": "休息", "Strength": "力量", "Missed": "未完成", "Marathon": "马拉松", "Goal 5K": "目标 5K",
  // plan headers
  "{n} km logged": "已记录 {n} 公里", "Paces": "配速表",
  // suggestion card
  "Rest ": "休息", "As planned": "按计划", "Quality": "强度课", "Gym": "健身房", "Cross-train": "交叉训练",
  "by Claude · 9:00": "Claude · 9:00 撰写", "Yesterday": "昨天", "Tomorrow:": "明天：", "Next:": "接下来：",
  "Form": "跑姿", "Why it works": "原理", "Numbers": "数据", "Prehab · 2×/week, ~15 min": "预防性训练 · 每周 2 次，约 15 分钟",
  "From recurring form issues in the logged runs. After easy runs or on rest days; stop if anything hurts.":
    "根据记录中反复出现的跑姿问题生成。在轻松跑后或休息日做；如有疼痛请停止。",
  "VDOT and paces: Jack Daniels' formula. Easy ceiling ≈ 79% of max HR seen.":
    "VDOT 与配速：Jack Daniels 公式。轻松跑心率上限 ≈ 已记录最大心率的 79%。",
  "Loading today's suggestion…": "正在加载今天的建议…",
  "No suggestion yet today. It's written at 9:00 after the Garmin sync.": "今天还没有建议。每天 9:00 同步 Garmin 后生成。",
  "Couldn't load the suggestion: {e}": "无法加载建议：{e}",
  "Claude writes this every morning at 9:00 from the sessions logged here. Nothing for today yet.":
    "Claude 每天早上 9:00 根据这里记录的训练撰写。今天还没有。",
  "New sessions logged since this was written. They're in tomorrow's 9:00 suggestion.":
    "此建议生成后又记录了新训练，会体现在明天 9:00 的建议中。",
  // log / dashboard
  "My log": "我的记录", "+ Add activity": "+ 添加训练", "Loading…": "加载中…",
  "Nothing added yet. Add runs, gym or swims here — on or off the plan, past sessions too.":
    "还没有记录。可在这里添加跑步、健身或游泳——计划内外、过去的训练都可以。",
  "Show fewer": "收起", "Show all {n}": "显示全部 {n} 条",
  "Training calendar": "训练日历", "Minutes per week": "每周训练分钟",
  "From what's logged here: ticked plan sessions plus added activities.": "数据来自这里的记录：已勾选的计划训练 + 添加的训练。",
  "From Garmin, updated {t}.": "来自 Garmin，更新于 {t}。",
  "Week of {d}: {n} min": "{d} 这周：{n} 分钟",
  "push": "推", "pull": "拉", "legs": "腿", "reinforce": "强化", "gym": "健身", "run": "跑步", "swim": "游泳",
  "bike": "骑行", "hike": "徒步", "other": "其他",
  // board
  "Last {n} weeks": "最近 {n} 周",
  "Top: share of planned sessions ticked off. Below: training minutes that week (WGW from Garmin; TJH and SJH from what they log). Tap a runner to open their week.":
    "上：计划训练完成比例。下：当周训练分钟（WGW 来自 Garmin；TJH、SJH 来自自己的记录）。点击跑者查看当周。",
  "{n} km run": "跑步 {n} 公里",
  // status / toasts
  "Offline — changes may not be saved": "离线——更改可能未保存", "Synced {t}": "已同步 {t}",
  "Couldn't save — check your connection": "保存失败——请检查网络", "Saved ✓": "已保存 ✓",
  "Couldn't save: {e}": "保存失败：{e}", "Couldn't delete: {e}": "删除失败：{e}", "Couldn't remove: {e}": "移除失败：{e}",
  "Distance should be a number of km": "距离应为公里数", "Time should look like 32:10 or 1:02:30": "时间格式如 32:10 或 1:02:30",
  "Pace should look like 5:40": "配速格式如 5:40", "Heart rate should be 40–230": "心率应在 40–230 之间",
  "Delete this activity?": "删除这条训练？",
  "Un-tick this session? Its logged details and photo will be removed.": "取消勾选？已记录的详情和照片将被删除。",
  "Reading screenshot…": "正在读取截图…", "Reading…": "读取中…",
  "Filled from screenshot — check & Save": "已从截图填写——请检查后保存",
  "Couldn't find stats in that image": "未能从图片中识别数据", "Filled {f} — check & Save": "已填写 {f}——请检查后保存",
  "Photo saved — tap ✨ to read stats from it": "照片已保存——点 ✨ 读取数据", "Upload failed: {e}": "上传失败：{e}",
  "Photo unavailable": "照片不可用", "Loading photo…": "照片加载中…", "Uploading…": "上传中…",
  "distance": "距离", "time": "时间", "HR": "心率", "pace": "配速",
  // sheets
  "New activity": "新训练", "Edit activity": "编辑训练", "Activity": "训练", "Date": "日期", "Type": "类型",
  "Title": "标题", "optional": "选填", "Distance": "距离", "Time": "时间", "Avg pace": "平均配速", "Avg HR": "平均心率",
  "Cadence": "步频", "Note": "备注", "How did it feel?": "感觉如何？", "How did it feel? Splits, weather…": "感觉如何？分段、天气…",
  "📷 Fill from a watch screenshot": "📷 从手表截图填写", "📷 Add photo or watch screenshot": "📷 添加照片或手表截图",
  "✨ Fill from screenshot": "✨ 从截图填写", "Remove": "移除", "Delete": "删除", "Save": "保存", "Un-tick": "取消勾选",
  "Additional": "更多数据", "{n} filled": "已填 {n} 项",
  "Running form and other watch details. They make the daily suggestion more specific.": "跑姿和其他手表数据，让每日建议更具体。",
  "Run": "跑步", "Swim": "游泳", "Bike": "骑行", "Hike / walk": "徒步 / 走路", "Other": "其他",
  "Max HR": "最大心率", "Vertical oscillation": "垂直振幅", "Avg stride": "平均步幅", "Ground contact": "触地时间",
  "L/R balance": "左右平衡", "left %": "左 %", "Avg power": "平均功率", "Elevation gain": "累计爬升", "Training load": "训练负荷",
  "Start time": "开始时间", "Weather": "天气", "Km splits": "每公里分段", "Split HR": "分段心率",
  "Passcode": "密码", "Ask the group for the Run Club passcode. You only need to enter it once per device.":
    "向群里要 Run Club 密码。每台设备只需输入一次。", "Unlock": "解锁", "+ add details": "+ 添加详情",
  // empty plans
  "No plan entered for this week yet — add it to SJH_WEEKS in plans.js.": "本周还没有录入计划。",
  "8-week plan finished 🎉 Time for a new goal.": "8 周计划完成 🎉 该定新目标了。",
};

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
