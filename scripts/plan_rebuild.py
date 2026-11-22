"""Rebuild the rest of a runner's plan with Claude and leave it in the app for them to accept (lib/rebuild.js).

    python3 -I scripts/plan_rebuild.py TJH

GET /api/rebuild gives the prompt (their computed paces, realistic goal range, weekly km, usual days); Claude drafts the
weeks; POST /api/rebuild checks the draft against those limits and stores it as a waiting proposal. A refused draft
goes back to Claude once with the reason. Same safety as the daily job: no tools, an empty directory, leak check.
Needs RUNCLUB_PASSCODE.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from peer_suggest import SITE, ask_claude, leaks  # noqa: E402


def call(method, path, body=None):
    req = urllib.request.Request(f"{SITE}{path}", method=method, data=json.dumps(body).encode() if body else None,
                                 headers={"x-passcode": os.environ.get("RUNCLUB_PASSCODE", ""), "user-agent": "run-club-daily",
                                          "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def main():
    person = sys.argv[1] if len(sys.argv) > 1 else "TJH"
    today = dt.date.today().isoformat()
    code, ctx = call("GET", f"/api/rebuild?person={person}&today={today}")
    if code != 200:
        print(f"  {person}: no rebuild: {ctx.get('error')}", file=sys.stderr)
        return 1
    prompt = ctx["prompt"]
    for attempt in (1, 2, 3):
        draft = ask_claude(prompt)
        bad = leaks(draft)
        if bad:
            print(f"  {person}: REFUSED: fields {bad} look like system/personal details", file=sys.stderr)
            return 1
        code, res = call("POST", "/api/rebuild", {"person": person, "today": today, "draft": draft})
        if code == 200:
            p = res["proposal"]
            print(f"  {person}: proposal {p['start']}..{p['end']}, goal 5K {p['goal5k']}, {len(p['sessions'])} sessions: {p['why']}")
            return 0
        print(f"  {person}: draft {attempt} refused: {res.get('error')}", file=sys.stderr)
        prompt += (f"\n\nYOUR PREVIOUS DRAFT WAS REFUSED BY THE CHECK: {res.get('error')}\n"
                   "Fix that and reply with the whole JSON again.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
