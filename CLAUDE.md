# Run Club

Weekly running plans for three runners (TJH, WGW, SJH) with logging, a shared dashboard and a daily
suggestion per runner. Cloudflare Pages + Functions + D1. See README.md for layout, deploy and the daily job.

## Rules
- **This repo is public.** Never commit runners' data: seed SQL stays in `seed/` (gitignored), `public/wgw.json`
  is generated (gitignored), `.dev.vars` holds secrets. No health data, names beyond the initials, or personal paths.
- WGW's Garmin health data (HRV, sleep, body battery, weights) never comes into this repo or onto the site.
  Only `public/wgw.json` (calendar, weekly minutes, a qualitative suggestion) is written here, by WGW's private hook.
  Exception WGW chose: the suggestion's gym block shows the *prescribed* kg for the next session (computed in the
  hook); weights lifted in past sessions still never appear.
- Club: each runner's prompt may include the other runners' recent sessions (`lib/club.js`, quoted as data) for one
  optional "club" line; the advice itself stays this runner's. WGW appears to others only via public `wgw.json`.
- Coaching numbers (VDOT, zones, form bands, prehab) are computed in `lib/`; the model only phrases them.
  When a computed value would mislead (e.g. a VDOT from a sub-maximal run), fix the computation, not the prompt.
- Deploy from the repo root: `npx wrangler pages deploy --branch main --commit-dirty=true`.
  D1: `npx wrangler d1 execute run-club --remote ...` (needs CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID).
