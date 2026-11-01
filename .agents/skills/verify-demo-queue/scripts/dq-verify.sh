#!/usr/bin/env bash
# Launch, check and stop a verification instance of demo-queue (Next.js only)
# against the shared development Convex deployment precious-elk-564.
#
#   dq-verify.sh up [port]       start `next dev` on port (default 3001), wait until it answers
#   dq-verify.sh doctor [port]   read-only: is this instance ours, up, on this checkout, on dev?
#   dq-verify.sh down [port]     stop only the instance this script started on that port
#   dq-verify.sh evidence <name> create and print a fresh evidence folder
#
# It never runs `convex dev`, `convex deploy` or `convex:sync`, never prints
# .env.local values, and never stops a process it did not start.
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
PORT="${2:-3001}"
STATE="${TMPDIR:-/tmp}/dq-verify/$(basename "$ROOT")-$PORT"
EVIDENCE_ROOT="$ROOT/.verify-evidence"
DEV_DEPLOYMENT="dev:precious-elk-564"
DEV_URL="https://precious-elk-564.convex.cloud"

die() { echo "dq-verify: $*" >&2; exit 1; }

env_selector() {
  # Prints only whether .env.local selects the canonical dev deployment.
  [[ -f "$ROOT/.env.local" ]] || { echo "env_local_missing"; return; }
  local dep url
  dep="$(grep -E '^CONVEX_DEPLOYMENT=' "$ROOT/.env.local" | head -1 | cut -d= -f2 | cut -d' ' -f1)"
  url="$(grep -E '^NEXT_PUBLIC_CONVEX_URL=' "$ROOT/.env.local" | head -1 | cut -d= -f2 | cut -d' ' -f1)"
  if [[ "$dep" == "$DEV_DEPLOYMENT" && "$url" == "$DEV_URL" ]]; then echo "ok $DEV_DEPLOYMENT"; else echo "deployment_mismatch"; fi
}

listener_pid() { lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true; }

# The pid we recorded, or a process in its group that owns the port.
owns_port() {
  local pid owner pgid
  pid="$(cat "$STATE/pid" 2>/dev/null || true)"
  owner="$(listener_pid)"
  [[ -n "$pid" && -n "$owner" ]] || return 1
  pgid="$(ps -o pgid= -p "$owner" 2>/dev/null | tr -d ' ')"
  [[ "$pgid" == "$pid" ]]
}

up() {
  [[ "$(env_selector)" == ok* ]] || die ".env.local is $(env_selector); copy main's .env.local (see SKILL.md), do not edit it"
  [[ -d "$ROOT/node_modules" ]] || die "no node_modules; run: CI=true pnpm install --frozen-lockfile"
  [[ -z "$(listener_pid)" ]] || die "port $PORT is already in use by pid $(listener_pid); pick another port, never stop someone else's server"
  mkdir -p "$STATE"
  : > "$STATE/next.log"
  # A new session makes the pid its process group id, so `down` can stop
  # next and its workers together without touching anything else.
  (
    cd "$ROOT"
    export NEXT_PUBLIC_WORKOS_REDIRECT_URI="http://localhost:$PORT/callback"
    export PORT
    exec perl -e 'use POSIX; POSIX::setsid(); exec @ARGV' -- \
      node_modules/.bin/next dev -p "$PORT"
  ) >> "$STATE/next.log" 2>&1 &
  echo $! > "$STATE/pid"
  echo "$PORT" > "$STATE/port"
  git -C "$ROOT" rev-parse --short HEAD > "$STATE/head"
  for _ in $(seq 1 90); do
    if grep -q "Ready in" "$STATE/next.log" && [[ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/events")" == "200" ]]; then
      echo "ready http://localhost:$PORT pid=$(cat "$STATE/pid") log=$STATE/next.log"
      return 0
    fi
    kill -0 "$(cat "$STATE/pid")" 2>/dev/null || { tail -20 "$STATE/next.log" >&2; die "next exited during start"; }
    sleep 1
  done
  tail -20 "$STATE/next.log" >&2
  die "not ready after 90 s; run: $0 down $PORT"
}

doctor() {
  local fail=0 code head
  echo "checkout:  $ROOT ($(git -C "$ROOT" branch --show-current) @ $(git -C "$ROOT" rev-parse --short HEAD))"
  echo "env.local: $(env_selector)"
  if [[ -f "$STATE/pid" ]] && kill -0 "$(cat "$STATE/pid")" 2>/dev/null; then
    echo "process:   up, pid $(cat "$STATE/pid") (started by dq-verify)"
  else
    echo "process:   not running (no instance started by dq-verify on port $PORT)"; fail=1
  fi
  if owns_port; then echo "port:      $PORT owned by our instance"
  elif [[ -n "$(listener_pid)" ]]; then echo "port:      $PORT owned by someone else (pid $(listener_pid)); do not drive it"; fail=1
  else echo "port:      $PORT has no listener"; fail=1
  fi
  head="$(cat "$STATE/head" 2>/dev/null || echo none)"
  if [[ "$head" != "$(git -C "$ROOT" rev-parse --short HEAD)" ]]; then
    echo "build:     started at $head, checkout now at $(git -C "$ROOT" rev-parse --short HEAD) (next dev hot-reloads app code; restart after env or config changes)"
  else
    echo "build:     started at $head (current HEAD)"
  fi
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "http://localhost:$PORT/events" || true)"
  echo "http:      GET /events -> ${code:-no answer}"; [[ "$code" == "200" ]] || fail=1
  local signin
  signin="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 20 "http://localhost:$PORT/events/sign-in" || true)"
  if [[ "$signin" == 307*"redirect_uri=http%3A%2F%2Flocalhost%3A$PORT%2Fcallback"* ]]; then
    echo "auth:      sign-in redirects to WorkOS with callback on port $PORT"
  else
    echo "auth:      sign-in -> ${signin%% *}; callback is not localhost:$PORT (sign-in would land on another server)"; fail=1
  fi
  echo "convex:    $(cd "$ROOT" && node -- scripts/convex-dev.mjs check 2>/dev/null | tail -1 | jq -r '"\(.status) \(.deployment) \(.reason // "")"' 2>/dev/null || echo "check failed to run")"
  exit "$fail"
}

down() {
  local pid
  pid="$(cat "$STATE/pid" 2>/dev/null || true)"
  [[ -n "$pid" ]] || { echo "nothing to stop on port $PORT (no instance started by dq-verify)"; return 0; }
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 10); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    kill -0 "$pid" 2>/dev/null && kill -KILL -- "-$pid" 2>/dev/null || true
  fi
  rm -f "$STATE/pid" "$STATE/head" "$STATE/port"
  if [[ -n "$(listener_pid)" ]]; then echo "stopped pid $pid, but port $PORT still has a listener (pid $(listener_pid)): not ours, left alone"
  else echo "stopped pid $pid; port $PORT free; log kept at $STATE/next.log"
  fi
}

evidence() {
  local name="${2:?usage: dq-verify.sh evidence <name>}" dir
  dir="$EVIDENCE_ROOT/$(date +%Y%m%d-%H%M%S)-$name"
  mkdir -p "$dir"
  echo "$dir"
}

case "${1:-}" in
  up) up ;;
  doctor) doctor ;;
  down) down ;;
  evidence) evidence "$@" ;;
  *) sed -n '2,11p' "$0"; exit 2 ;;
esac
