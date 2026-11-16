# Run Club

Weekly running checklist for TJH / WGW / SJH with a shared progress dashboard.
Cloudflare Pages (static UI) + Pages Functions (`/api/*`) + D1 (SQLite). Daily suggestions are written by Claude
(Claude Code CLI, `claude -p`) on a Mac at 09:00 and stored in D1.

```
public/plans.js        ← all plan content (edit this to change sessions)
public/app.js          ← UI logic
public/index.html      ← layout + styles
functions/api/progress.js    ← API (GET range / POST tick)
functions/api/activities.js  ← TJH/SJH own activity log (GET range / POST add-edit / DELETE)
functions/api/today.js       ← TJH/SJH daily suggestion (GET: prompt for Claude; POST: read today's)
functions/api/extract.js     ← read a watch screenshot (Mistral vision)
lib/                   ← shared helpers: week/plan text, form bands, coaching metrics, sports-science rules
schema.sql, migrations/ ← D1 tables
scripts/daily.sh       ← the 09:00 job (WGW hook → TJH/SJH suggestions → deploy)
scripts/peer_suggest.py ← Claude writes TJH/SJH suggestions
docs/original-plans/   ← the plan pages the sessions in plans.js were copied from
seed/                  ← local only (gitignored): history sent in chat, loaded with wrangler d1 execute
```

Privacy: this repo is public. Runners' data lives only in D1 (behind the PASSCODE) and in the gitignored `seed/`.
`public/wgw.json` is generated daily outside the repo's history (gitignored) and only holds what WGW chose to publish.

## Deploy (one time, ~5 min)

```sh
cd run_club
npm install
npx wrangler login                         # opens browser
npx wrangler d1 create run-club            # copy the database_id it prints…
#   …into wrangler.toml → database_id
npm run db:init                            # create the table in the remote DB
npx wrangler pages project create run-club --production-branch main
npm run deploy                             # → https://run-club.pages.dev
npx wrangler pages secret put PASSCODE     # shared passcode for the 3 of you
npm run deploy                             # redeploy so the secret applies
```

Send the URL + passcode to the others. On a phone: open it → Share → **Add to Home Screen**.
(Skip the PASSCODE step if you don't want one; the API is then open to anyone with the URL.)

## Session logs & photos

Tapping a session ticks it and opens a log sheet: distance / time / pace (auto) / avg HR / note / photo.
Photos are resized on the phone (~1600px JPEG) and stored in D1. **✨ Fill from screenshot** reads a
watch/Strava/Garmin summary with Mistral vision (the only thing Mistral is still used for; the suggestions are
written by Claude, see below).

```sh
npx wrangler pages secret put MISTRAL_API_KEY   # once
npm run db:migrate                              # once, if the DB was created with the first schema
npm run deploy
```
Models tried in order (free tier rate-limits per model): mistral-small → ministral-14b → ministral-8b.
Set a `MISTRAL_MODEL` secret to prefer a different one. (The DeepSeek fallback and the weekly Coach card were
removed; a `DEEPSEEK_API_KEY` secret, if set, is unused and can be deleted, as can the old `coach` table.)

## Run locally

```sh
npm run db:init:local
npm run dev            # http://localhost:8788  (PASSCODE / MISTRAL_API_KEY from .dev.vars)
```

## Weekly upkeep

- Weeks are keyed by their Monday, so each week starts empty automatically; old weeks stay for the dashboard.
- **TJH**: 8-week plan, Week 1 = `TJH_START` in `plans.js` (currently 2026-11-16).
- **WGW**: same 3 sessions every week.
- **SJH**: add next week's block to `SJH_WEEKS` in `plans.js`, then `npm run deploy`.
- Deep links: `/?tab=board`, `/?tab=SJH&week=2026-11-16`.
- **⚙ Settings** (per device): language EN / 中文 and theme Auto / Light / Dark. UI strings live in
  `public/i18n.js` (keyed by the English text; anything untranslated falls back to English). Suggestions carry a
  Chinese copy (`zh`) made by a second Claude call at 09:00; WGW's copy passes the same privacy check.
  Plan content in `plans.js` (session titles, notes) is shown as written.
- **📊 All** tab: per runner, plan progress, this week's training minutes (by type; km run for TJH/SJH), and today's
  call + headline; the 5-week table shows plan % with that week's minutes underneath.

## WGW: daily suggestion + Garmin summary

The WGW tab shows **Today** (a suggestion card under the plan) and, at the bottom, a training calendar
and minutes per week. Both come from `public/wgw.json`. That file is public, like everything in `public/`.
`scripts/daily.sh` refreshes and redeploys it every day at 09:00 (LaunchAgent `local.run-club-daily`). WGW's Garmin
pipeline is private and lives outside this repo; the job runs it through the `WGW_HOOK` environment variable
(set in the LaunchAgent), and that script writes `public/wgw.json` (`RUN_CLUB_DIR` points it here).

```sh
scripts/daily.sh --no-deploy                         # dry run: no D1 writes, no deploy
launchctl kickstart gui/$(id -u)/local.run-club-daily   # run the scheduled job now
tail -f ~/Library/Logs/run-club-daily.log
```

## TJH / SJH: own log, calendar and daily suggestion

Each of their tabs has **Today** (under the plan and, for TJH, the Paces table), **My log** (+ Add activity, tap a row to edit/delete,
📷 fills the form from a watch screenshot via Mistral) and the same training calendar + minutes per week as WGW.
The calendar counts ticked plan sessions (logged time, else the plan's "NN min") plus added activities; an
activity on the same date and type as a ticked session replaces it, so nothing is counted twice.

Today's suggestion: one per runner per day, from the plan (today/tomorrow spelled out) and the last 21 days of
sessions. No sessions in 21 days → no suggestion. `POST /api/today` only reads it; if sessions were logged after it
was written, the card says they'll be in the next morning's suggestion.
Each suggestion (WGW's too) opens with a one-line comment on yesterday: what was done vs what was suggested.
At 09:00 `scripts/daily.sh` → `scripts/peer_suggest.py` has **Claude** write TJH's and SJH's suggestions (`GET /api/today` gives
the prompt; the result is upserted into `suggestions` with `by:"claude"`). The prompt carries computed HR CHECK (vs the plan's easy target) and FORM CHECK lines
(Garmin running-dynamics bands, `lib/form.js`); the card's **Form** line is computed in code, not by the model.
The activity form's **Additional** section holds max HR, vertical oscillation, stride, ground contact, L/R balance,
power, elevation, training load, start time, weather and splits (`activities.extra`).
**Numbers** (`lib/metrics.js`, computed per request, shown on the card and given to the model): VDOT from the best
run of ≥3 km in 120 days (Daniels formula; marked "≥" when the effort wasn't all-out) and the training paces it gives,
the goal's VDOT (from the plan's G pace), max HR seen in a year → easy ceiling ≈79%, each run's %HRmax zone,
28-day easy share (80/20), HR-weighted load (ratio only with logs in each of the last 4 weeks), aerobic decoupling
from per-km splits + HR, and pacing for test days from the best recent ~5K.
**Sports science / prehab** (`lib/science.js`): recurring form flags (`formFlags` in `lib/form.js`) are mapped to
mechanisms (overstriding → braking and patellofemoral/tibial load; long contact → calf–Achilles capacity; asymmetry →
glute medius / single-leg strength) and a prehab routine with sets and reps; a base routine when nothing recurs.
Plus physiology notes (easy share, tissue adaptation vs ramp, late runs and sleep). Muscle roles follow WGW's anatomy
notes (joint action → prime movers). The card shows "Why it works" (Claude) and "Prehab".
If you set a PASSCODE, also put `export RUNCLUB_PASSCODE=...` in `~/.zsh_secrets` so the 09:00 job can read the context.

```sh
npm run db:migrate                                            # once: migrations/0003_activities.sql
npx wrangler d1 execute run-club --remote --file=seed/<file>.sql   # load history sent in chat
```

## Security

Runner-typed text (titles, notes, extra fields) ends up in the prompt Claude reads at 09:00, so it is treated as
a prompt-injection risk. Layers, each of which stands on its own:

1. **Input limits** (`lib/rules.js` `TEXT_RULES`, enforced by `/api/activities`): title ≤ 40 characters of letters,
   digits and basic punctuation; weather ≤ 30; splits digits/colons/spaces; split HR digits/spaces; numbers have
   ranges. Notes stay free text (≤ 300, control characters stripped) because they carry things like "left knee sore".
2. **Quoted as data**: the prompt shows runner text as JSON strings via `untrusted()`, and `RULES` tells the model
   it is data, never instructions.
3. **No tools**: every headless `claude -p` call uses `--tools ""` *and* `--strict-mcp-config` with an empty MCP
   config. `--tools ""` alone leaves the account's MCP connectors (Gmail, Drive, Garmin…) callable. Calls run in an
   empty directory (no CLAUDE.md or memory).
4. **Output guard, fail closed** (`scripts/peer_suggest.py` `leaks()`; `build_public.py` for WGW's public card):
   Claude Code always gives the model some account/machine context (email, OS, working directory) that can't be
   turned off without an API key, so a card containing emails, links, paths, IPs, the machine's user or host name,
   or system terms is refused and not stored.
5. **Browser**: everything shown is HTML-escaped, and `public/_headers` sets a CSP that only allows this site's own
   files and API. If you edit the inline theme script in `index.html`, update its hash (`scripts/csp_hash.sh`).

Also: the data API needs the shared PASSCODE; all three runners share it, so any of them can edit any entry.
