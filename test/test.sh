#!/usr/bin/env bash
# redline self-check. Exercises set -> statusline (sensor) -> hook (pacer)
# end to end against a throwaway HOME. Fails loudly if pacing breaks.
set -euo pipefail
BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/../bin" && pwd)"
export HOME="$(mktemp -d)"
trap 'rm -rf "$HOME"' EXIT
SID="sess-test"
fail() { echo "FAIL: $1"; exit 1; }

# 1. Set a $1 + 5m budget.
node "$BIN/set.js" "5m \$1" "$SID" >/dev/null
[ -f "$HOME/.claude/redline/$SID.json" ] || fail "config not written"

# 2. Statusline at 50 cents = 50% of the $1 budget.
SL=$(echo "{\"session_id\":\"$SID\",\"cost\":{\"total_cost_usd\":0.50},\"model\":{\"display_name\":\"Opus\"}}" | node "$BIN/statusline.js")
echo "$SL" | grep -q "redline" || fail "statusline missing label"
echo "$SL" | grep -q "50%" || fail "statusline wrong percent: $SL"
[ -f "$HOME/.claude/redline/$SID.state.json" ] || fail "state snapshot not written"

# 3. PostToolUse hook should fire the 50% convergence message exactly once.
H1=$(echo "{\"session_id\":\"$SID\",\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"Bash\"}" | node "$BIN/hook.js")
echo "$H1" | grep -q "additionalContext" || fail "hook produced no context"
echo "$H1" | grep -qi "converg\|prioritise\|Half" || fail "hook missing pacing guidance: $H1"
# Re-firing at the same threshold stays silent.
H2=$(echo "{\"session_id\":\"$SID\",\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"Bash\"}" | node "$BIN/hook.js")
[ -z "$H2" ] || fail "hook re-fired at same threshold: $H2"

# 4. UserPromptSubmit always injects a status line.
H3=$(echo "{\"session_id\":\"$SID\",\"hook_event_name\":\"UserPromptSubmit\",\"prompt\":\"hi\"}" | node "$BIN/hook.js")
echo "$H3" | grep -q "budget used" || fail "UserPromptSubmit missing status: $H3"

# 5. Clearing removes config.
node "$BIN/set.js" "off" "$SID" >/dev/null
[ -f "$HOME/.claude/redline/$SID.json" ] && fail "config not cleared" || true

echo "PASS: redline self-check"
