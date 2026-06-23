#!/usr/bin/env bash
# redline self-check: set -> statusline (sensor) -> hook (pace + enforce).
# Covers the soft-landing guarantee AND the session-wide budget umbrella
# (fanned subagents share the same budget: counted + enforced).
set -euo pipefail
export NO_COLOR=1 FORCE_COLOR=0
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

# 3. PostToolUse fires the 50% nudge once, then quiet at the same threshold.
H=$(echo "{\"session_id\":\"$SID\",\"hook_event_name\":\"PostToolUse\"}" | node "$BIN/hook.js")
echo "$H" | grep -qi "Half\|prioritise" || fail "no 50% nudge: $H"
H2=$(echo "{\"session_id\":\"$SID\",\"hook_event_name\":\"PostToolUse\"}" | node "$BIN/hook.js")
[ -z "$H2" ] || fail "re-fired same threshold: $H2"

# 4. Landing zone: time budget aged ~84% triggers the mandatory wrap.
setcfg "{\"session_id\":\"$SID\",\"set_at\":$(( $(now) - 252 )),\"duration_sec\":300}"
H=$(echo "{\"session_id\":\"$SID\",\"hook_event_name\":\"PostToolUse\"}" | node "$BIN/hook.js")
echo "$H" | grep -qi "Landing zone\|Deliver your final" || fail "no landing directive at 84%: $H"

# 5. ENFORCEMENT: aged ~96% -> PreToolUse DENIES tools (never-over guarantee).
setcfg "{\"session_id\":\"$SID\",\"set_at\":$(( $(now) - 288 )),\"duration_sec\":300}"
P=$(echo "{\"session_id\":\"$SID\",\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Bash\"}" | node "$BIN/hook.js")
echo "$P" | grep -q '"permissionDecision":"deny"' || fail "tools NOT denied in reserve zone: $P"

# 6. Below the lock line, tools are allowed (no deny).
setcfg "{\"session_id\":\"$SID\",\"set_at\":$(( $(now) - 150 )),\"duration_sec\":300}"  # 50%
P=$(echo "{\"session_id\":\"$SID\",\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Bash\"}" | node "$BIN/hook.js")
[ -z "$P" ] || fail "tool wrongly denied below lock: $P"

# 7. UMBRELLA — a SUBAGENT tool call (same session_id, has agent_id) is ALSO
#    denied in the reserve zone. Subagents share the budget; no separate budget.
setcfg "{\"session_id\":\"$SID\",\"set_at\":$(( $(now) - 288 )),\"duration_sec\":300}"
P=$(echo "{\"session_id\":\"$SID\",\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Read\",\"agent_id\":\"sub-1\",\"agent_type\":\"general-purpose\"}" | node "$BIN/hook.js")
echo "$P" | grep -q '"permissionDecision":"deny"' || fail "subagent tool NOT denied under umbrella: $P"

# 8. UMBRELLA — SubagentStart injects the shared budget status into the subagent.
S=$(echo "{\"session_id\":\"$SID\",\"hook_event_name\":\"SubagentStart\",\"agent_id\":\"sub-1\"}" | node "$BIN/hook.js")
echo "$S" | grep -qi "budget" || fail "SubagentStart didn't inject budget status: $S"

# 9. UMBRELLA — token sum counts main transcript + subagent transcripts.
PROJ="$HOME/proj"; mkdir -p "$PROJ/sX/subagents"
MAIN="$PROJ/sX.jsonl"
printf '%s\n' '{"type":"assistant","message":{"usage":{"input_tokens":100,"output_tokens":50}}}' > "$MAIN"
printf '%s\n' '{"type":"assistant","message":{"usage":{"input_tokens":1000,"output_tokens":500}}}' > "$PROJ/sX/subagents/agent-a.jsonl"
TOK=$(node -e 'console.log(require("'"$BIN"'/lib.js").sumTranscriptTokens(process.argv[1]))' "$MAIN")
[ "$TOK" = "1650" ] || fail "token sum should include subagents (want 1650, got $TOK)"

# 10. No continue:false anywhere (no abrupt kill, ever).
grep -q '"continue"' "$BIN/hook.js" && fail "hook.js emits continue:false (abrupt kill banned)" || true

# 11. Clearing removes config.
node "$BIN/set.js" "off" "$SID" >/dev/null
[ -f "$D/$SID.json" ] && fail "config not cleared" || true

echo "PASS: redline self-check (soft-landing enforcement + session-wide subagent umbrella)"
