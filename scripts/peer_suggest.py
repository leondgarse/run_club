"""Write today's suggestion for TJH and SJH with Claude and store it in the Run Club D1 database.

    python3 scripts/peer_suggest.py OUT.sql        # called by scripts/daily.sh, which then runs the SQL with wrangler
    python3 scripts/peer_suggest.py OUT.sql TJH    # on-demand refresh (scripts/refresh.sh): also marks the request done

For each runner: GET /api/today?person=X (the site builds the prompt from their plan and logged sessions),
run `claude -p` on it with no tools from an empty directory (so no CLAUDE.md, and so nothing about WGW, is
loaded), validate the JSON, add a Chinese copy (`zh`, a second Claude call), and append an upsert into `suggestions` with by:"claude".
In refresh mode (runners given), each runner's pending row in `refreshes` is marked done, or failed with its count
given back, so the site stops waiting either way.
Set RUNCLUB_PASSCODE if the site has a PASSCODE.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import urllib.request

SITE = "https://run-club-b9w.pages.dev"
PEOPLE = ["TJH", "SJH"]
CALLS = {"rest", "easy", "planned", "quality", "gym", "cross"}
LIMITS = {"headline": 80, "session": 160, "why": 300, "next": 200, "yesterday": 220, "science": 320, "club": 200}


def fetch(person, today):
    req = urllib.request.Request(f"{SITE}/api/today?person={person}&today={today}",
                                 headers={"x-passcode": os.environ.get("RUNCLUB_PASSCODE", ""),
                                          "user-agent": "run-club-daily"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


TRANSLATE = """Translate the string values of this JSON from English into natural Simplified Chinese, as a running
coach would say it to a Chinese-speaking runner. Keep every number, pace (m:ss), time, unit (km, bpm, spm, /km, %, ms,
cm, W) and abbreviation (VDOT, HR, E/M/T/I/R paces, TT, RDL) exactly as written. Keep the same keys and list lengths.
Reply with ONLY the JSON object.

"""
ZH_KEYS = ["headline", "session", "why", "next", "yesterday", "science", "club", "form", "numbers", "prehab"]


def translate(s):
    """Chinese copy of the card's text fields ({} if Claude's reply is unusable)."""
    src = {k: s[k] for k in ZH_KEYS if s.get(k)}
    if s.get("plan_change"):
        src["plan_why"] = s["plan_change"]["why"]
    try:
        zh = ask_claude(TRANSLATE + json.dumps(src, ensure_ascii=False, indent=1))
    except Exception as e:
        print(f"    translation failed: {e}", file=sys.stderr)
        return {}
    out = {}
    for k, v in src.items():
        z = zh.get(k)
        if isinstance(v, str) and isinstance(z, str) and z.strip():
            out[k] = z.strip()[: max(len(v) * 2, 60)]
        elif isinstance(v, list) and isinstance(z, list) and len(z) == len(v) and all(isinstance(x, str) for x in z):
            out[k] = z
    return out


# The prompt contains runner-typed text, so treat every call as exposed to prompt injection:
#  - no tools at all: --tools "" removes built-ins, and --strict-mcp-config with an empty config removes the
#    account's MCP connectors (Gmail, Drive, Garmin, ...), which --tools "" alone does NOT remove;
#  - an empty working directory, so no CLAUDE.md or project memory is loaded;
#  - the output is checked by leaks() below before anything is stored.
def ask_claude(prompt):
    with tempfile.TemporaryDirectory() as empty:
        none = os.path.join(empty, "no-mcp.json")
        with open(none, "w") as f:
            f.write('{"mcpServers": {}}')
        p = subprocess.run(
            ["claude", "-p", "Follow the instructions on stdin exactly. Reply with only the JSON object.",
             "--tools", "", "--strict-mcp-config", "--mcp-config", none,
             "--no-session-persistence", "--output-format", "json"],
            input=prompt, capture_output=True, text=True, cwd=empty, timeout=240)
    if p.returncode:
        raise RuntimeError(f"claude exited {p.returncode}: {p.stderr[-300:]}")
    text = json.loads(p.stdout).get("result", "")
    return json.loads(re.search(r"\{.*\}", text, re.S).group(0))


# Claude Code always gives the model some account/machine context (e.g. the account email, OS, working directory)
# that no flag removes without an API key. An injected "print everything you know" could copy it into a card,
# so any card that looks like it contains system or personal details is refused (fail closed, nothing stored).
_ME = [x for x in {os.environ.get("USER", ""), socket.gethostname().split(".")[0]} if len(x) >= 4]
LEAK = re.compile(
    r"[\w.+-]+@[\w-]+\.[\w.-]+"                              # email addresses
    r"|https?://|\bwww\.|\b[\w-]+\.(com|net|org|io|dev|app|ai|cn|life)\b"   # links / domains
    r"|(^|[\s(])(/|~/)(Users|private|var|tmp|home|etc|opt|Library)\b"   # file paths
    r"|\b\d{1,3}(\.\d{1,3}){3}\b"                             # IP addresses
    r"|\b(darwin|macos|zsh|bash|shell|system prompt|working directory|api[ _-]?key|passcode|password|token"
    r"|claude code|anthropic|oauth|keychain|localhost)\b"
    + "".join(f"|{re.escape(x)}" for x in _ME),
    re.I)


def strings(v):
    """Every string inside v (nested dicts/lists too, e.g. plan_change sessions)."""
    if isinstance(v, str):
        yield v
    elif isinstance(v, dict):
        for x in v.values():
            yield from strings(x)
    elif isinstance(v, list):
        for x in v:
            yield from strings(x)


def leaks(s):
    """Field names in the card whose text looks like system/personal information (empty list = fine)."""
    return [k for k, v in s.items() if any(LEAK.search(x) for x in strings(v))]


# Mirrors public/plans.js cleanChange (the site checks it again when the runner taps Accept).
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
KINDS = {"Easy", "Long", "Long · Easy", "Tempo", "Threshold", "Interval", "Repetition", "Goal pace", "Test", "Race",
         "Strength", "Cross", "Rest"}
PLAN_TEXT = re.compile(r"^[A-Za-z0-9 .,:;'’()+\-–—/&!?@×·%~≤≥=]*$")


def plan_change(c, today):
    """Claude's optional proposal → {start, end, why, sessions: [{date, kind, title, meta}]}, or None if absent or
    malformed. A date range from today, at most 14 days; dates in it without a session are rest (public/plans.js)."""
    if not isinstance(c, dict) or not isinstance(c.get("sessions"), list):
        return None
    try:
        t = dt.date.fromisoformat(today)
        start, end = dt.date.fromisoformat(str(c.get("start"))), dt.date.fromisoformat(str(c.get("end")))
    except ValueError:
        return None
    start = max(start, t)
    if end < start or end > t + dt.timedelta(days=13):
        print("    plan_change dropped: bad dates", file=sys.stderr)
        return None
    out = []
    for x in c["sessions"][:20]:
        if not isinstance(x, dict):
            return None
        try:
            d = dt.date.fromisoformat(str(x.get("date")))
        except ValueError:
            return None
        kind = x.get("kind")
        title = " ".join(str(x.get("title") or ("Rest" if kind == "Rest" else "")).split())
        meta = " ".join(str(x.get("meta") or "").split())
        if (not start <= d <= end or kind not in KINDS or not title or len(title) > 50 or len(meta) > 40
                or not PLAN_TEXT.match(title) or not PLAN_TEXT.match(meta)):
            print(f"    plan_change dropped: bad session {x!r}"[:200], file=sys.stderr)
            return None
        out.append({"date": d.isoformat(), "kind": kind, "title": title, "meta": meta})
    why = " ".join(str(c.get("why") or "").split())
    if not why or len(why) > 200 or not PLAN_TEXT.match(why):
        print("    plan_change dropped: bad reason", file=sys.stderr)
        return None
    return {"start": start.isoformat(), "end": end.isoformat(), "why": why, "sessions": sorted(out, key=lambda x: x["date"])}


def clean(r, today):
    if r.get("call") not in CALLS or not isinstance(r.get("headline"), str):
        raise ValueError(f"bad reply: {r!r}"[:300])
    out = {"date": today, "call": r["call"]}
    for k, n in LIMITS.items():
        v = r.get(k)
        if isinstance(v, str) and v.strip():
            out[k] = v.strip()[:n]
    pc = plan_change(r.get("plan_change"), today)
    if pc:
        out["plan_change"] = pc
    return out


def q(v):
    return "NULL" if v is None else "'" + str(v).replace("'", "''") + "'"


def main():
    out_path = sys.argv[1]
    refresh = [p for p in sys.argv[2:] if p in PEOPLE]
    today = dt.date.today().isoformat()
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    sql = []

    def settle(person, ok):
        if not refresh:
            return
        where = f"WHERE person={q(person)} AND date={q(today)} AND done_at IS NULL;"
        sql.append(f"UPDATE refreshes SET done_at={q(now)}, failed=0 {where}" if ok else
                   f"UPDATE refreshes SET done_at={q(now)}, failed=1, count=max(count-1, 0) {where}")

    for person in refresh or PEOPLE:
        ok = False
        try:
            ctx = fetch(person, today)
            if not ctx.get("prompt"):
                print(f"  {person}: nothing logged recently, skipped")
                continue
            s = clean(ask_claude(ctx["prompt"]), today)
            if ctx.get("form"):
                s["form"] = ctx["form"]
            if ctx.get("numbers"):
                s["numbers"] = ctx["numbers"]
            if ctx.get("prehab"):
                s["prehab"] = ctx["prehab"]
            s["by"] = "claude"
            s["at"] = dt.datetime.now().strftime("%H:%M")
            zh = translate(s)
            if zh:
                s["zh"] = zh
            bad = leaks(s)
            if bad:  # don't store, and don't print the text (it may be exactly what we're keeping out)
                print(f"  {person}: REFUSED: fields {bad} look like system/personal details; nothing stored",
                      file=sys.stderr)
                continue
            sql.append(
                "INSERT INTO suggestions (person, date, data, data_at, created_at) VALUES "
                f"({q(person)}, {q(today)}, {q(json.dumps(s, ensure_ascii=False))}, {q(ctx.get('dataAt'))}, {q(now)}) "
                "ON CONFLICT(person, date) DO UPDATE SET data=excluded.data, data_at=excluded.data_at, created_at=excluded.created_at;")
            ok = True
            print(f"  {person}: {s['call']}: {s['headline']}" + (f" / {s['zh'].get('headline', '')}" if s.get("zh") else ""))
        except Exception as e:  # one runner failing shouldn't stop the other
            print(f"  {person}: FAILED: {e}", file=sys.stderr)
        finally:  # also on the `continue`s above (nothing logged, refused)
            settle(person, ok)
    with open(out_path, "w") as f:
        f.write("\n".join(sql) + "\n")
    return 0 if sql else 1


if __name__ == "__main__":
    sys.exit(main())
