// Offline test of lib/screenshot.js label mapping with made-up transcriptions (no real runner data).
//   node scripts/test_screenshot.mjs
import assert from "node:assert/strict";
import { mapTranscription, parseDateTime } from "../lib/screenshot.js";

const today = "2026-11-16";
// English app layout (Huawei-like), incl. a Slowest/Fastest bar that must NOT become splits
let r = mapTranscription({
  title: "8 km easy run", datetime: "11/10/26, 6:05 AM", distance: { value: "8.00", unit: "km" },
  pairs: [
    { label: "Duration", value: "48:00" }, { label: "Avg pace", value: "6'00\"", unit: "/km" },
    { label: "Total calories", value: "500", unit: "kcal" }, { label: "Avg cadence", value: "170", unit: "spm" },
    { label: "Avg stride", value: "98", unit: "cm" }, { label: "Avg heart rate", value: "145", unit: "bpm" },
    { label: "Training load", value: "90" }, { label: "Average balance", value: "49.5% Left 50.5% Right" },
    { label: "Average ground contact time", value: "250", unit: "ms" },
    { label: "Average vertical oscillation", value: "8.0", unit: "cm" },
  ],
  splits: [{ km: "Slowest", pace: "6'10\"" }, { km: "Fastest", pace: "5'50\"" }],
}, today);
assert.equal(r.km, 8); assert.equal(r.duration, "48:00"); assert.equal(r.pace, "6:00"); assert.equal(r.hr, 145);
assert.equal(r.cadence, 170); assert.equal(r.extra.stride_m, 0.98); assert.equal(r.extra.lr_balance, 49.5);
assert.equal(r.extra.training_load, 90); assert.equal(r.date, "2026-11-10"); assert.equal(r.extra.start, "06:05");
assert.equal(r.extra.splits, undefined, "a 2-row slowest/fastest bar is not an 8 km split table");
assert.equal(r.type, "run");

// Chinese app layout (OPPO-like): calories must not become training load; "52.0%/48.0%" → left 52.0
r = mapTranscription({
  title: "户外跑步", datetime: null, distance: { value: "4.00", unit: "公里" },
  pairs: [
    { label: "时长", value: "24:00" }, { label: "平均配速", value: "6'00\"", unit: "/公里" },
    { label: "动态消耗", value: "300", unit: "千卡" }, { label: "平均步频", value: "160", unit: "步/分钟" },
    { label: "平均步幅", value: "1.04", unit: "米" }, { label: "平均心率", value: "150", unit: "次/分钟" },
    { label: "左右触地平衡", value: "52.0%/48.0%" }, { label: "平均触地时间", value: "270", unit: "毫秒" },
    { label: "平均垂直振幅", value: "9.5", unit: "厘米" }, { label: "平均功率", value: "250", unit: "瓦" },
    { label: "累计爬升", value: "3", unit: "米" },
  ], splits: [],
}, today);
assert.equal(r.km, 4); assert.equal(r.extra.training_load, undefined); assert.equal(r.extra.lr_balance, 52);
assert.equal(r.extra.stride_m, 1.04); assert.equal(r.date, null); assert.ok(r.notes.includes("no date in the image"));

// Cross-check: a misread pace (4:00 for 24 min / 4 km) is dropped, not filled in
r = mapTranscription({ distance: { value: "4", unit: "km" }, pairs: [{ label: "Duration", value: "24:00" }, { label: "Avg pace", value: "4'00\"" }] }, today);
assert.equal(r.pace, null);

// Dates
assert.deepEqual(parseDateTime("2026-07-28 18:10", today), { date: "2026-07-28", start: "18:10" });
assert.deepEqual(parseDateTime("11/14/26, 10:23 PM", today), { date: "2026-11-14", start: "22:23" });
assert.equal(parseDateTime("12/25/26", today).date, null, "future date is a misread");
console.log("screenshot mapping: all checks passed");
