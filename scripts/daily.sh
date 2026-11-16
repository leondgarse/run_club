#!/usr/bin/env bash
# Run Club daily job (LaunchAgent local.run-club-daily, 09:00, and on wake if the Mac was asleep):
#   1. $WGW_HOOK, if set: a private script that refreshes public/wgw.json (WGW's Garmin summary + suggestion).
#   2. scripts/peer_suggest.py: Claude writes TJH's and SJH's suggestions into D1.
#   3. wrangler pages deploy (so the new wgw.json goes live).
#   scripts/daily.sh              full run
#   scripts/daily.sh --no-deploy  no D1 writes, no deploy (dry run)
# Secrets come from ~/.zsh_secrets (launchd doesn't load shell rc files): only the lines needed are read.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export RUN_CLUB_DIR="$ROOT"
# claude finds its login via USER; launchd sets it, but a bare environment may not.
export USER="${USER:-$(id -un)}" LOGNAME="${LOGNAME:-$(id -un)}"
export PATH="$HOME/.local/bin:$HOME/.local/share/fnm/aliases/default/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
DEPLOY=1; [[ "${1:-}" == "--no-deploy" ]] && DEPLOY=0

log() { echo "[$(date '+%F %T')] $*"; }
fail() { log "FAILED: $*"; exit 1; }

if [[ -f "$HOME/.zsh_secrets" ]]; then
  [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]] && eval "$(grep -E '^export CLOUDFLARE_(API_TOKEN|ACCOUNT_ID)=' "$HOME/.zsh_secrets")"
  [[ -z "${RUNCLUB_PASSCODE:-}" ]] && eval "$(grep -E '^export RUNCLUB_PASSCODE=' "$HOME/.zsh_secrets")"
fi

if [[ -n "${WGW_HOOK:-}" ]]; then
  log "WGW hook: $WGW_HOOK"
  /bin/bash "$WGW_HOOK" || log "WGW hook failed; deploying the rest anyway"
fi

log "TJH/SJH suggestions"
PEER_SQL="$(mktemp).sql"
if python3 -I "$ROOT/scripts/peer_suggest.py" "$PEER_SQL"; then
  if (( DEPLOY )); then
    (cd "$ROOT" && npx --yes wrangler d1 execute run-club --remote --file="$PEER_SQL" 2>&1 | grep -E "Executed|ERROR") \
      || log "storing TJH/SJH suggestions failed"
  else
    log "dry run: not storing $(grep -c INSERT "$PEER_SQL") suggestion(s)"
  fi
else
  log "no TJH/SJH suggestions written"
fi
rm -f "$PEER_SQL"

if (( DEPLOY )); then
  log "deploy"
  (cd "$ROOT" && npx --yes wrangler pages deploy --branch main --commit-dirty=true 2>&1 | tail -3) || fail "deploy"
fi
log "done"
