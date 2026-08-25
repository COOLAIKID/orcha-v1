#!/usr/bin/env bash
# Shared agent channel.
#   ./channel.sh                    open replies + the last 30 lines
#   ./channel.sh <who> --inbox      only what <who> owes a reply to
#   ./channel.sh <who> --typing     signal "responding"; --done clears it
#   ./channel.sh <who> "message"    post
set -euo pipefail
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
file="$dir/CHANNEL.md"
api='http://127.0.0.1:5173/api/channel'
[ -f "$file" ] || { echo "CHANNEL.md not found next to this script" >&2; exit 1; }

show_owed() {
  local only="${1:-}"
  local json
  json="$(curl -s --max-time 4 "$api" 2>/dev/null)" || return 0
  [ -n "$json" ] || return 0
  printf '%s' "$json" | CHANNEL_ONLY="$only" python -c '
import sys, json, os
only = os.environ.get("CHANNEL_ONLY") or None
try:
    data = json.load(sys.stdin)
except Exception:
    raise SystemExit
owed = [o for o in data.get("owed", []) if only is None or o["to"] == only]
if not owed:
    print("OPEN REPLIES: none" if only is None else "Nothing owed by @%s." % only)
    raise SystemExit
print("OPEN REPLIES - reply to these before other work:")
for o in owed:
    print("  @%-9s owes @%-8s (%s)  %s" % (o["to"], o["from"], o["time"], o["excerpt"]))
' 2>/dev/null || true
}

if [ $# -eq 0 ]; then
  show_owed
  echo
  tail -n 30 "$file"
  exit 0
fi

[ $# -ge 2 ] || { echo 'Usage: ./channel.sh <who> "<message>"' >&2; exit 1; }

if [ "${2:-}" = "--inbox" ]; then
  show_owed "$1"
  exit 0
fi

# ./channel.sh <who> --typing   signal "responding"; ./channel.sh <who> --done  clears it
if [ "${2:-}" = "--typing" ] || [ "${2:-}" = "--done" ]; then
  on=true; [ "$2" = "--done" ] && on=false
  curl -s -X POST "$api" -H 'Content-Type: application/json' \
    -d "{\"from\":\"$1\",\"typing\":$on}" >/dev/null && echo "@$1 typing=$on"
  exit 0
fi

from="$1"; shift
body="$*"

# Prefer the Vite API so sandboxed agents (Codex) can post without writing CHANNEL.md
# themselves — the server process owns the file write.
payload="$(CHANNEL_FROM="$from" CHANNEL_BODY="$body" python -c 'import json,os; print(json.dumps({"from":os.environ["CHANNEL_FROM"],"body":os.environ["CHANNEL_BODY"]}))' 2>/dev/null || true)"
if [ -n "$payload" ]; then
  code="$(curl -s -o /tmp/orcha-channel-post.json -w '%{http_code}' -X POST "$api" \
    -H 'Content-Type: application/json' \
    --data-binary "$payload" 2>/dev/null || echo 000)"
  if [ "$code" = "200" ]; then
    echo "posted to CHANNEL.md as @$from"
    show_owed "$from"
    exit 0
  fi
fi

today="$(date +%Y-%m-%d)"
grep -q "^## $today" "$file" || printf '\n## %s\n' "$today" >> "$file"
printf '\n### %s @%s\n%s\n' "$(date +%H:%M)" "$from" "$body" >> "$file"
echo "posted to CHANNEL.md as @$from"
show_owed "$from"
