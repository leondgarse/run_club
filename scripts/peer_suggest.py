"""Write today's suggestion for TJH and SJH with Claude and store it in the Run Club D1 database.

    python3 scripts/peer_suggest.py OUT.sql        # called by scripts/daily.sh, which then runs the SQL with wrangler

For each runner: GET /api/today?person=X (the site builds the prompt from their plan and logged sessions),
run `claude -p` on it with no tools from an empty directory (so no CLAUDE.md, and so nothing about WGW, is
loaded), validate the JSON, and append an upsert into `suggestions` with by:"claude". Later the same day the
site only rewrites it (with Mistral) if new sessions are logged.
Set RUNCLUB_PASSCODE if the site has a PASSCODE.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request

SITE = "https://run-club-b9w.pages.dev"
PEOPLE = ["TJH", "SJH"]
CALLS = {"rest", "easy", "planned", "quality", "gym", "cross"}
LIMITS = {"headline": 80, "session": 160, "why": 300, "next": 200, "yesterday": 220, "science": 320}


def fetch(person, today):
    req = urllib.request.Request(f"{SITE}/api/today?person={person}&today={today}",
                                 headers={"x-passcode": os.environ.get("RUNCLUB_PASSCODE", ""),
                                          "user-agent": "run-club-daily"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def ask_claude(prompt):
    with tempfile.TemporaryDirectory() as empty:
        p = subprocess.run(
            ["claude", "-p", "Follow the instructions on stdin exactly. Reply with only the JSON object.",
             "--tools", "", "--no-session-persistence", "--output-format", "json"],
            input=prompt, capture_output=True, text=True, cwd=empty, timeout=240)
    if p.returncode:
        raise RuntimeError(f"claude exited {p.returncode}: {p.stderr[-300:]}")
    text = json.loads(p.stdout).get("result", "")
    return json.loads(re.search(r"\{.*\}", text, re.S).group(0))


def clean(r, today):
    if r.get("call") not in CALLS or not isinstance(r.get("headline"), str):
        raise ValueError(f"bad reply: {r!r}"[:300])
    out = {"date": today, "call": r["call"]}
    for k, n in LIMITS.items():
        v = r.get(k)
        if isinstance(v, str) and v.strip():
            out[k] = v.strip()[:n]
    return out


def q(v):
    return "NULL" if v is None else "'" + str(v).replace("'", "''") + "'"


def main():
    out_path = sys.argv[1]
    today = dt.date.today().isoformat()
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    sql = []
    for person in PEOPLE:
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
            sql.append(
                "INSERT INTO suggestions (person, date, data, data_at, created_at) VALUES "
                f"({q(person)}, {q(today)}, {q(json.dumps(s, ensure_ascii=False))}, {q(ctx.get('dataAt'))}, {q(now)}) "
                "ON CONFLICT(person, date) DO UPDATE SET data=excluded.data, data_at=excluded.data_at, created_at=excluded.created_at;")
            print(f"  {person}: {s['call']}: {s['headline']}")
        except Exception as e:  # one runner failing shouldn't stop the other
            print(f"  {person}: FAILED: {e}", file=sys.stderr)
    with open(out_path, "w") as f:
        f.write("\n".join(sql) + "\n")
    return 0 if sql else 1


if __name__ == "__main__":
    sys.exit(main())
