#!/usr/bin/env bash
# End-to-end check of the channel: presence detection, reply tracking, transport.
# Run from the repo root with the dev server up:  bash ./verify-channel.sh
set -uo pipefail
api='http://127.0.0.1:5173/api/channel'
pass=0; fail=0
ok()   { echo "  PASS  $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL  $1"; fail=$((fail+1)); }

echo "1. typescript build"
if (cd ui && npx tsc --pretty false --noEmit >/dev/null 2>&1); then ok "tsc clean"; else bad "tsc errors"; fi

echo "2. api shape"
json="$(curl -s --max-time 8 "$api")"
for key in messages agents owed typing; do
  printf '%s' "$json" | python -c "
import sys,json
d=json.load(sys.stdin)
raise SystemExit(0 if '$key' in d else 1)" && ok "returns $key" || bad "missing $key"
done

echo "3. presence detection"
printf '%s' "$json" | python -c '
import sys, json
d = json.load(sys.stdin)
agents = {a["from"]: a for a in d.get("agents", [])}
expected = {"claude", "codex", "cursor", "opencode"}
missing = expected - set(agents)
print("  %s  all four agents reported" % ("PASS" if not missing else "FAIL"))
if missing: print("        missing:", missing)
for name, a in sorted(agents.items()):
    # working must never be true while load sits at or below the learned floor
    consistent = (not a["working"]) or a["load"] >= a["baseline"]
    print("  %s  %-9s running=%-5s working=%-5s load=%-5s baseline=%s"
          % ("PASS" if consistent else "FAIL", name, a["running"], a["working"], a["load"], a["baseline"]))
'

echo "4. reply tracking (synthetic)"
python - <<'PY'
import json, urllib.request
with urllib.request.urlopen("http://127.0.0.1:5173/api/channel", timeout=8) as r:
    data = json.load(r)
messages = data["messages"]
owed = {o["to"]: o for o in data["owed"]}

# nobody should be shown owing a reply to a message they posted themselves
self_owed = [h for h, o in owed.items() if o["from"].lower() == h]
print("  %s  no self-owed entries" % ("PASS" if not self_owed else "FAIL"), self_owed or "")

# whoever posted last cannot owe anything
if messages:
    last = messages[-1]["from"].lower()
    print("  %s  last poster (@%s) owes nothing" % ("PASS" if last not in owed else "FAIL", last))

# every owed entry must reference a real message time
times = {m["time"] for m in messages}
bad_time = [o for o in data["owed"] if o["time"] not in times]
print("  %s  owed entries point at real messages" % ("PASS" if not bad_time else "FAIL"))
PY

echo "5. transport: unicode round-trip"
python - <<'PY'
import json, urllib.request, pathlib
probe = "verify probe — é → ✓"
req = urllib.request.Request("http://127.0.0.1:5173/api/channel",
    data=json.dumps({"from": "claude", "body": probe}).encode("utf-8"),
    headers={"Content-Type": "application/json"}, method="POST")
urllib.request.urlopen(req, timeout=8)
p = pathlib.Path("CHANNEL.md")
text = p.read_text(encoding="utf-8")
print("  %s  multi-byte characters survive a post" % ("PASS" if probe in text else "FAIL"))
# remove the probe so the channel stays clean
idx = text.rindex("### ", 0, text.index(probe))
p.write_text(text[:idx].rstrip() + "\n", encoding="utf-8")
PY

echo "6. typing heartbeat override"
bash ./channel.sh codex --typing >/dev/null 2>&1
curl -s --max-time 6 "$api" | python -c "
import sys,json
d=json.load(sys.stdin)
print('  %s  manual heartbeat appears' % ('PASS' if any(t['from']=='codex' for t in d.get('typing',[])) else 'FAIL'))"
bash ./channel.sh codex --done >/dev/null 2>&1
curl -s --max-time 6 "$api" | python -c "
import sys,json
d=json.load(sys.stdin)
print('  %s  --done clears it' % ('PASS' if not any(t['from']=='codex' for t in d.get('typing',[])) else 'FAIL'))"

echo "7. exactly one sampler process"
count=$(powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { \$_.CommandLine -like '* -File *orcha-channel-sampler.ps1*' -and \$_.CommandLine -notlike '*Get-CimInstance*' } | Measure-Object).Count" 2>/dev/null | tr -d '

 ')
count="$(printf '%s' "$count" | tr -cd '0-9')"   # strip stray CR/whitespace from PowerShell
[ "${count:-0}" -eq 1 ] && ok "one sampler" || bad "sampler count = ${count:-unknown}"

echo
echo "checks passed in this shell: $pass, failed: $fail (python-reported PASS/FAIL lines counted separately above)"
