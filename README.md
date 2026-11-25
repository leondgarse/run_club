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
functions/api/plan.js        ← TJH/WGW plan changes: accept Claude's proposal / revert (GET range, POST)
functions/api/goal.js        ← one-line target per runner (English; 中文 copy by the AI on save)
functions/api/refresh.js     ← TJH/SJH ↻ Refresh: queue a rewrite (max 5/day); the Mac polls the queue
functions/api/actphoto.js    ← up to 3 photos/screenshots per My log activity (GET/PUT/DELETE by idx 0-2)
functions/api/extract.js     ← read a watch screenshot (DeepSeek / Mistral vision)
lib/                   ← shared helpers: week/plan text, form bands, coaching metrics, sports-science rules
schema.sql, migrations/ ← D1 tables
scripts/daily.sh       ← the 09:00 job (WGW hook → TJH/SJH suggestions → deploy)
scripts/peer_suggest.py ← Claude writes TJH/SJH suggestions
scripts/refresh.sh     ← every 2 min: serve queued ↻ Refresh requests (LaunchAgent local.run-club-refresh)
docs/original-plans/   ← the plan pages the sessions in plans.js were copied from
miniprogram/           ← WeChat mini program (native UI on the same API); setup in docs/wechat-miniprogram.md (中文)
functions/api/wxlogin.js ← mini program sign-in: wx.login code → session token (WX_APPID / WX_SECRET secrets)
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
watch/Strava/Garmin summary with a vision model (`ai()` in `lib/shared.js`; the suggestions are written by Claude,
see below).

```sh
npx wrangler pages secret put DEEPSEEK_API_KEY  # once (MISTRAL_API_KEY optional, used as a fallback)
npm run db:migrate                              # once, if the DB was created with the first schema
npm run deploy
```
Providers tried in order: DeepSeek `deepseek-flash` (reads images), then Mistral (mistral-small → ministral-14b →
ministral-8b). A provider without a key is skipped; on 402 (no credit), 429 or 5xx the next one is tried.
Override the model with a `DEEPSEEK_MODEL` / `MISTRAL_MODEL` secret.

## Run locally

```sh
npm run db:init:local
npm run dev            # http://localhost:8788  (PASSCODE / DEEPSEEK_API_KEY from .dev.vars)
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
- **🎯 Target** (top of each runner's tab, tap to edit): one line in English, ≤ 60 characters of letters, digits and
  basic punctuation (`TEXT_RULES.goal`), plus an optional race date. `/api/goal` stores it with a Chinese copy made by
  the AI on save, shown when the language is 中文. It feeds the daily suggestion: `lib/goal.js` computes days to go,
  the phase (build / taper / race week / race day, taper length by distance) and the race distance read from the text
  vs the longest run in 28 days. Changing it marks today's suggestion out of date, so ↻ Refresh shows (counts in the 5).
  WGW's private hook fetches WGW's own target into its context. Migration: `migrations/0005_goals.sql`.
  The same sheet has two optional numbers for TJH/SJH (not WGW: their health data stays off the site): **max HR**
  from a race or test and **resting HR** (`migrations/0008_profile_hr.sql`). Nothing else is asked (no age, weight
  or birthday). `lib/metrics.js` uses the given max unless the logs beat it, and with a resting HR the easy ceiling is
  74% of heart-rate reserve (Karvonen form of Daniels' E zone) instead of 79% of max.
- **Plan changes (TJH, WGW)**: the daily suggestion may carry a `plan_change`, the sessions for the rest of this
  week (from today) or for next week, with a reason. It's for when the week no longer fits (a target date needing a
  taper/race week, sessions piling up, pain notes), not for one day. The Today card shows it with **Accept** /
  **Dismiss** (dismiss is per device). Accept → `/api/plan` re-validates it (`cleanChange` in `plans.js`: kinds from a
  fixed list, English workout notation, days from today on, this or next week only) and stores it in `plan_changes`
  (`migrations/0006_plan_changes.sql`); `planFor(person, week, changes)` applies it everywhere (UI, prompts, calendar),
  replacing the days from `from` on; days left out become rest. The header shows "✎ Adjusted · reason · Revert".
  TJH's proposals are validated in `peer_suggest.py`; WGW's in the private `build_public.py` (also the privacy check)
  and WGW's context gets the accepted change. SJH's plan comes from their own app and isn't changed.
- **📊 All** tab: a Mon–Sun strip per runner (planned sessions: done / missed / today / upcoming, shown on the day
  they were done; "+" marks training beyond the plan; rest days empty), "done/total +extra" and days trained.
  `weekDays()` in `plans.js` builds it; WGW's sessions count as done from the Garmin calendar (same matching as the
  server). Also: per runner, plan progress, this week's training minutes (by type; km run for TJH/SJH), and today's
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
📷 fills the form from a watch screenshot via the vision model) and the same training calendar + minutes per week as WGW.
The calendar counts ticked plan sessions (logged time, else the plan's "NN min") plus added activities; an
activity on the same date and type as a ticked session replaces it, so nothing is counted twice.

Today's suggestion: one per runner per day, from the plan (today/tomorrow spelled out) and the last 21 days of
sessions. No sessions in 21 days → no suggestion. `POST /api/today` only reads it.
**↻ Refresh**: when sessions were logged after the suggestion was written (e.g. after Add activity), the card offers
a refresh, max 5 per runner per day (`refreshes` table, `migrations/0004_refresh.sql`). The site can't run Claude, so
`POST /api/refresh` only queues it; `scripts/refresh.sh` (LaunchAgent `local.run-club-refresh`, every 2 min, silent
when idle) runs `peer_suggest.py OUT.sql TJH` and marks the request done. A failed one gets its count back; requests
from an earlier day (Mac asleep) are closed. The card polls while it waits and shows the time it was written.
With the Mac off, a request waits until it's back on. Install the agent once (same shape as `local.run-club-daily`,
`StartInterval` 120 instead of a calendar time, no `WGW_HOOK`), then `launchctl bootstrap gui/$(id -u) <plist>`.
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

## Sessions done on another day

Saving a run/gym/swim without a session link re-plans the automatic links around it (`lib/match.js`): unticked plan
sessions of the same type take an activity on the same day, else one done a day late, else a day early (early only
once that day is over). Tests/races only take an activity whose title or note says test/race. Matched sessions are
ticked with the activity's numbers and shown on the day they were done ("Planned Thu, done here"); a hand un-tick
puts the session in `auto_skip` (`migrations/0010_auto_skip.sql`) so it isn't matched again. Calendar and coaching
numbers count a linked session once. Backfill: `POST /api/activities {person, relink: true, date}`.

## Plan changes over a date range

A proposal is `{start, end, why, sessions: [{date, kind, title, meta}]}`: from today, at most 14 days, may cross into
next week; dates in the range without a session are rest. `splitChange` (`plans.js`) splits it per week and each week
stores the days it replaces (`{days: {"5": [], "6": []}}`), so it merges with a change accepted earlier that week.
Older `{week, from, sessions}` changes still read. The target's set date goes into the prompt, so "till next
Wednesday" resolves from the day it was written.

## Club line

Each daily prompt gets a CLUB section (`lib/club.js`): the other runners' last 14 days (paces, HR, cadence, titles
and notes quoted as data) and their computed numbers; WGW only as the minutes/call in public `wgw.json`. Claude may
write one `club` line (shown as "Club" on the card) when a clubmate is clearly better at what this runner needs.
WGW's private hook gets the same section from `GET /api/club?person=WGW`.

## Charts (TJH / SJH tabs)

`public/charts.js` (shared with the mini program and the server's HR zone / race distance) turns their runs into:
**aerobic efficiency** on easy runs (metres per heartbeat = speed ÷ HR, runs at or under the easy ceiling; a trend
line only with 4+ runs over 3+ weeks), **pace vs heart rate** for every run in 120 days with the easy-ceiling line,
and a **goal chart**: a long race (half/full) → longest run per week against the race distance and date; a short one
(5K/10K) → times over that distance from runs of about that length against the goal time in the target text.
One series each in the runner's colour, reference lines muted, hover tooltips and a table view under each.
SJH: when next week has no plan, the daily suggestion drafts one (`plan_change`, fill-only: `FILL_ONLY` in
`plans.js`; the API refuses it for a week that has a plan); it shows on that week's page to accept.

## Plan rebuild (TJH)

`python3 -I scripts/plan_rebuild.py TJH` has Claude rewrite the rest of the plan around the runner (`lib/rebuild.js`):
code sets the limits (paces from the VDOT of their best actual run, easy pace from their HR but never faster than M;
a realistic 5K at the end of the plan from the weeks left; weekly km from their last weeks, ≤ ~10% a week; the run
days of their most recent weeks), Claude arranges the weeks within them, and `POST /api/rebuild` checks the draft
(kinds, dates, no quality pace faster than theirs, weekly km) and stores it in `plan_proposals`
(`migrations/0011_plan_proposals.sql`); a refused draft goes back to Claude with the reason (3 tries). The proposal
waits on their Today card (Accept / Dismiss); Accept stores it per week like any plan change, with its paces and goal,
so the Paces table and the pace/HR checks follow it. Run it again after a real 5K test to re-fit.

## Screenshot reading

**Plan sessions (TJH/SJH)**: the log sheet keeps the quick fields, and "📷 Screenshots → full details in My log"
opens Add activity prefilled from the session and linked to it (`activities.week/item`,
`migrations/0007_activity_links_photos.sql`). Saving puts it in My log ("✓ plan") and copies km/time/pace/HR/note to the
ticked session, so the plan's checks see them; one activity per session. WGW's log sheet keeps the single photo.
**Up to 3 screenshots** per activity: each is read on its own (one AI call each, in turn) and merged into the
form; a field one screenshot filled isn't overwritten by the next. They're stored with the activity (`activity_photos`).
Images taller (or wider) than 3:1 are refused (long scrolling captures shrink until the model can't read them);
the rest are resized to ~2.4 MP, so a tall phone screenshot keeps a readable width.

In **Add activity**, pick a screenshot or just **paste** one (also: paste on TJH's/SJH's tab opens the form; paste in
a session log attaches it as the photo; drag-and-drop works). `/api/extract` sends it to the vision model, which only
**transcribes** label/value pairs, title, date text and any per-km table; `lib/screenshot.js` maps labels to fields
with an EN/中文 glossary, converts units, and cross-checks (distance × pace ≈ time, cadence × stride ≈ speed, split
count ≈ km), dropping values that don't fit. Works with any crop: only what's visible is filled. Tested on Huawei
Health (EN) and OPPO Health (中文); new apps need their labels added to `GLOSSARY`.
`node scripts/test_screenshot.mjs` runs the offline mapping tests (made-up data). `samples/` is gitignored.

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
