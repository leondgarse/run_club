#!/usr/bin/env bash
# On-demand suggestion refresh (LaunchAgent local.run-club-refresh, every 2 min).
# The site's ↻ Refresh button (TJH/SJH, max 5/day) queues a row in `refreshes`; this picks pending ones up,
# has Claude rewrite those runners' suggestions (scripts/peer_suggest.py OUT.sql TJH ...) and stores them in D1.
# Silent when nothing is pending, so the log only shows real work. No deploy needed (suggestions live in D1).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITE="https://run-club-b9w.pages.dev"
export USER="${USER:-$(id -un)}" LOGNAME="${LOGNAME:-$(id -un)}"
export PATH="$HOME/.local/bin:$HOME/.local/share/fnm/aliases/default/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
log() { echo "[$(date '+%F %T')] refresh: $*"; }

if [[ -f "$HOME/.zsh_secrets" ]]; then
  [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]] && eval "$(grep -E '^export CLOUDFLARE_(API_TOKEN|ACCOUNT_ID)=' "$HOME/.zsh_secrets")"
  [[ -z "${RUNCLUB_PASSCODE:-}" ]] && eval "$(grep -E '^export RUNCLUB_PASSCODE=' "$HOME/.zsh_secrets")"
fi

PENDING="$(curl -fsS --max-time 20 -H "x-passcode: ${RUNCLUB_PASSCODE:-}" -H "user-agent: run-club-daily" \
  "$SITE/api/refresh?pending=1")" || exit 0   # offline: quietly try again next time
TODAY="$(date +%F)"
# "TJH SJH" for today's requests; requests from another day (Mac was asleep) are closed with their count given back.
read -r PEOPLE STALE < <(python3 -I -c '
import json, sys
rows = json.loads(sys.argv[1]).get("pending", [])
now = [r["person"] for r in rows if r["date"] == sys.argv[2]]
old = [r for r in rows if r["date"] != sys.argv[2]]
print(",".join(sorted(set(now))) or "-", ";".join(r["person"] + "|" + r["date"] for r in old) or "-")
' "$PENDING" "$TODAY")
[[ "$PEOPLE" == "-" && "$STALE" == "-" ]] && exit 0

SQL="$(mktemp).sql"
if [[ "$PEOPLE" != "-" ]]; then
  log "rewriting for ${PEOPLE//,/ }"
  python3 -I "$ROOT/scripts/peer_suggest.py" "$SQL" ${PEOPLE//,/ } || log "no suggestion written"
fi
if [[ "$STALE" != "-" ]]; then
  NOW="$(date -u +%FT%T.000Z)"
  IFS=';' read -ra OLD <<< "$STALE"
  for pd in "${OLD[@]}"; do
    log "closing stale request ${pd}"
    echo "UPDATE refreshes SET done_at='$NOW', failed=1, count=max(count-1, 0) WHERE person='${pd%|*}' AND date='${pd#*|}' AND done_at IS NULL;" >> "$SQL"
  done
fi
(cd "$ROOT" && npx --yes wrangler d1 execute run-club --remote --file="$SQL" 2>&1 | grep -E "Executed|ERROR") \
  || log "storing failed"
rm -f "$SQL"
log "done"
