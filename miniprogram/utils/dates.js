// Date and time helpers (same rules as public/app.js).
export const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const mondayOf = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return addDays(x, -((x.getDay() + 6) % 7)); };
export const fromIso = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
export const thisWeek = () => iso(mondayOf(new Date()));
export const todayIso = () => iso(new Date());
export const todayIndex = () => (new Date().getDay() + 6) % 7;
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Accept "32:10", "1:02:30", or digits-only "3210" / "10230". "" when empty, null when invalid.
export function normTime(v, { pace = false } = {}) {
  v = String(v || "").trim().replace(/[.,'′″\s]+/g, ":");
  if (!v) return "";
  if (/^\d+$/.test(v)) {
    if (v.length <= 2) return pace ? "" : `${+v}:00`;
    const s = v.slice(-2), rest = v.slice(0, -2);
    v = rest.length > 2 && !pace ? `${+rest.slice(0, -2)}:${rest.slice(-2)}:${s}` : `${+rest}:${s}`;
  }
  const parts = v.split(":").map(Number);
  if (parts.some(isNaN) || parts.length < 2 || parts.length > (pace ? 2 : 3) || parts.slice(1).some((x) => x > 59)) return null;
  return parts.map((x, i) => (i === 0 ? String(x) : String(x).padStart(2, "0"))).join(":");
}
export const toSec = (t) => t.split(":").map(Number).reduce((a, x) => a * 60 + x, 0);
export const fmtPace = (secPerKm) => `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, "0")}`;
/** Pace from km + time fields, or "" when either is missing. */
export function autoPace(km, time) {
  const k = parseFloat(String(km || "").replace(",", "."));
  const t = normTime(time);
  return k > 0 && t ? fmtPace(toSec(t) / k) : "";
}
