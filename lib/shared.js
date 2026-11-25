// Shared helpers for the Pages Functions (not routed — lives outside functions/).

export const PEOPLE = new Set(["TJH", "WGW", "SJH"]);
export const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const ITEM = /^[a-z0-9-]{1,32}$/;

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

/** Validates {person, week, item?} from any object; throws 400 on bad input. */
export function key(src, { item = true } = {}) {
  const person = src.person, week = src.week, it = src.item;
  if (!PEOPLE.has(person) || !DATE.test(week || "") || (item && !ITEM.test(it || ""))) {
    throw new HttpError(400, "bad input");
  }
  return { person, week, item: it };
}

export const fromQuery = (request) => Object.fromEntries(new URL(request.url).searchParams);

export function toB64(buf) {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
export const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// Vision/text chat, tried in order: DeepSeek (deepseek-flash reads images), then Mistral. A provider without a key
// is skipped; on 402 (no credit), 429 (rate limit) or 5xx we fall through to the next. Both speak the OpenAI format.
// Override the model with DEEPSEEK_MODEL / MISTRAL_MODEL.
const PROVIDERS = [
  { key: "DEEPSEEK_API_KEY", url: "https://api.deepseek.com/chat/completions", env: "DEEPSEEK_MODEL",
    models: ["deepseek-flash"] },
  { key: "MISTRAL_API_KEY", url: "https://api.mistral.ai/v1/chat/completions", env: "MISTRAL_MODEL",
    models: ["mistral-small-latest", "ministral-14b-latest", "ministral-8b-latest"] },
];

/** Calls the first working chat-completions provider and returns the reply text. */
export async function ai(env, messages, { json: wantJson = false, maxTokens = 400 } = {}) {
  const ready = PROVIDERS.filter((p) => env[p.key]);
  if (!ready.length) throw new HttpError(503, "AI is not set up (DEEPSEEK_API_KEY / MISTRAL_API_KEY missing)");
  let last = 0;
  for (const p of ready) {
    for (const model of [...new Set([env[p.env], ...p.models].filter(Boolean))]) {
      const res = await fetch(p.url, {
        method: "POST",
        headers: { authorization: `Bearer ${env[p.key]}`, "content-type": "application/json" },
        body: JSON.stringify({
          model, messages, max_tokens: maxTokens, temperature: 0.4,
          ...(wantJson ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      last = res.status;
      if (res.status === 402) break; // this provider is out of credit: skip its other models
      if (res.status === 429 || res.status >= 500) continue;
      if (!res.ok) throw new HttpError(502, `AI request failed (${res.status})`);
      const data = await res.json();
      const c = data.choices?.[0]?.message?.content;
      return Array.isArray(c) ? c.map((x) => x.text || "").join("") : String(c || "");
    }
  }
  throw last === 429
    ? new HttpError(429, "AI is busy (rate limit) — try again in a minute")
    : new HttpError(502, `AI request failed (${last})`);
}

/** Wraps a handler so HttpErrors become JSON responses. */
export const handle = (fn) => async (ctx) => {
  try {
    return await fn(ctx);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "server error" }, 500);
  }
};

// On-demand suggestion refreshes (TJH/SJH): queued here, served by scripts/refresh.sh on the Mac.
export const REFRESH_LIMIT = 5;
/** Public view of a `refreshes` row: { used, left, pending, failed }. */
export const refreshInfo = (r) => ({
  used: r?.count || 0,
  left: Math.max(REFRESH_LIMIT - (r?.count || 0), 0),
  pending: !!(r && r.requested_at && !r.done_at),
  failed: !!r?.failed,
});

// ── Auth: the shared passcode (web) or a WeChat mini program session token (functions/api/wxlogin.js) ──
/** Constant-time string compare. */
export function same(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < b.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export const passcodeOk = (env, v) => !env.PASSCODE || same(String(v || ""), env.PASSCODE);
export async function sha256Hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** "Authorization: Bearer <token>" → the signed-in WeChat user's { openid, person }, or null. */
export async function wxSession(env, request) {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get("authorization") || "");
  if (!m) return null;
  return env.DB.prepare(
    "SELECT s.openid, u.person FROM wx_sessions s JOIN wx_users u ON u.openid = s.openid " +
    "WHERE s.token_hash = ?1 AND s.expires_at > ?2",
  ).bind(await sha256Hex(m[1]), new Date().toISOString()).first();
}
