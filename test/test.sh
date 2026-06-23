#!/usr/bin/env bash
# redline self-check: set -> statusline (sensor) -> hook (pace + enforce).
# Verifies the soft-landing guarantee: deny tools in the reserve zone, never over.
set -euo pipefail
BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/../bin" && pwd)"
export HOME="$(mktemp -d)"
trap 'rm -rf "$HOME"' EXIT
SID="sess-test"; D="$HOME/.claude/redline"
fail() { echo "FAIL: $1"; exit 1; }
now() { date +%s; }
setcfg() { mkdir -p "$D"; echo "$1" > "$D/$SID.json"; rm -f "$D/$SID.state.json"; }

# 1. /redline parses time + $.
node "$BIN/set.js" "5m \$1" "$SID" >/dev/null
[ -f "$D/$SID.json" ] || fail "config not written"

# 2. Statusline renders a bar + writes state at 50%.
SL=$(echo "{\"session_id\":\"$SID\",\"cost\":{\"total_cost_usd\":0.50}}" | node "$BIN/statusline.js")
echo "$SL" | grep -q "50%" || fail "statusline percent wrong: $SL"
echo "$SL" | grep -q "█" || fail "statusline missing bar: $SL"

# 3. PostToolUse fires the 50% nudge once, then stays quiet at same threshold.
H=$(echo "{\"session_id\":\"$SID\",\"hook_event_name\":\"PostToolUse\"}" | node "$BIN/hook.js")
echo "$H" | grep -qi "Half\|prioritise" || fail "no 50% nudge: $H"
H2=$(echo "{\"session_id\":\"$SID\",\"hook_event_name\":\"PostToolUse\"}" | node "$BIN/hook.js")
[ -z "$H2" ] || fail "re-fired same threshold: $H2"

# 4. Landing zone: a time budget aged to ~84% triggers the mandatory wrap.
setcfg "{\"session_id\":\"$SID\",\"set_at\":$(( $(now) - 252 )),\"duration_sec\":300}"
H=$(echo "{\"session_id\":\"$SID\",\"hook_event_name\":\"PostToolUse\"}" | node "$BIN/hook.js")
echo "$H" | grep -qi "Landing zone\|Deliver your final" || fail "no landing directive at 84%: $H"

# 5. ENFORCEMENT: aged to ~96% -> PreToolUse DENIES tools (the never-over guarantee).
setcfg "{\"session_id\":\"$SID\",\"set_at\":$(( $(now) - 288 )),\"duration_sec\":300}"
P=$(echo "{\"session_id\":\"$SID\",\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Bash\"}" | node "$BIN/hook.js")
echo "$P" | grep -q '"permissionDecision":"deny"' || fail "tools NOT denied in reserve zone: $P"
echo "$P" | grep -qi "reserve" || fail "deny missing reason: $P"

# 6. Below the lock line, tools are allowed (no deny).
setcfg "{\"session_id\":\"$SID\",\"set_at\":$(( $(now) - 150 )),\"duration_sec\":300}"  # 50%
P=$(echo "{\"session_id\":\"$SID\",\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Bash\"}" | node "$BIN/hook.js")
[ -z "$P" ] || fail "tool wrongly denied below lock: $P"

# 7. No continue:false anywhere (no abrupt kill, ever).
grep -q '"continue"' "$BIN/hook.js" && fail "hook.js emits continue:false (abrupt kill banned)" || true

# 8. Clearing removes config.
node "$BIN/set.js" "off" "$SID" >/dev/null
[ -f "$D/$SID.json" ] && fail "config not cleared" || true

echo "PASS: redline self-check (pace + reserve-landing enforcement, no abrupt kill)"
