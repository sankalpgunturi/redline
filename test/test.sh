#!/usr/bin/env bash
# redline self-check (CLI v2 + analytics).
set -euo pipefail
export NO_COLOR=1 FORCE_COLOR=0
BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/../bin" && pwd)"
export HOME="$(mktemp -d)"; trap 'rm -rf "$HOME"' EXIT
SID="sess-test"; D="$HOME/.claude/redline"
fail() { echo "FAIL: $1"; exit 1; }
now() { date +%s; }
setcfg() { mkdir -p "$D"; echo "$1" > "$D/$SID.json"; rm -f "$D/$SID.state.json"; }
setstate() { mkdir -p "$D"; echo "$1" > "$D/$SID.state.json"; }
hook() { echo "$1" | node "$BIN/hook.js"; }

# 1. parse
node "$BIN/set.js" "5m \$1" "$SID" >/dev/null; [ -f "$D/$SID.json" ] || fail "config not written"

# 2. statusline bar + state(peak)
SL=$(echo "{\"session_id\":\"$SID\",\"cost\":{\"total_cost_usd\":0.50}}" | node "$BIN/statusline.js")
echo "$SL" | grep -q "█" || fail "no bar"
grep -q '"peak"' "$D/$SID.state.json" || fail "peak not tracked in state"

# 3. ledger: <redline> block + tier on PostToolUse
setcfg "{\"session_id\":\"$SID\",\"set_at\":$(( $(now) - 60 )),\"duration_sec\":300,\"dollars\":5}"
setstate "{\"cost_usd\":1.0,\"tokens\":50000}"
H=$(hook "{\"session_id\":\"$SID\",\"hook_event_name\":\"PostToolUse\"}")
echo "$H" | grep -q "<redline>" || fail "no <redline> ledger: $H"
echo "$H" | grep -q "<total_tokens>" || fail "no native <total_tokens> signal: $H"
echo "$H" | grep -q "tier HIGH" || fail "wrong tier at 20%: $H"

# 4. tiers
setcfg "{\"session_id\":\"$SID\",\"set_at\":$(( $(now) - 225 )),\"duration_sec\":300}"  # 75%
hook "{\"session_id\":\"$SID\",\"hook_event_name\":\"PostToolUse\"}" | grep -q "tier LOW" || fail "expected LOW at 75%"

# 5. PreToolUse deny in reserve (90-99%)
setcfg "{\"session_id\":\"$SID\",\"set_at\":$(( $(now) - 285 )),\"duration_sec\":300}"  # 95%
hook "{\"session_id\":\"$SID\",\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Bash\"}" | grep -q '"permissionDecision":"deny"' || fail "no deny at 95%"

# 6. PreToolUse continue:false at >=100%
setcfg "{\"session_id\":\"$SID\",\"set_at\":$(( $(now) - 320 )),\"duration_sec\":300}"  # 107%
hook "{\"session_id\":\"$SID\",\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Bash\"}" | grep -q '"continue":false' || fail "no hard halt at ceiling"

# 7. UserPromptSubmit BLOCK at ceiling (the bug fix)
hook "{\"session_id\":\"$SID\",\"hook_event_name\":\"UserPromptSubmit\",\"prompt\":\"do more\"}" | grep -q '"decision":"block"' || fail "new prompt not blocked when spent"

# 8. UserPromptSubmit ledger below ceiling
setcfg "{\"session_id\":\"$SID\",\"set_at\":$(( $(now) - 60 )),\"duration_sec\":300}"  # 20%
hook "{\"session_id\":\"$SID\",\"hook_event_name\":\"UserPromptSubmit\",\"prompt\":\"hi\"}" | grep -q "<redline>" || fail "no ledger on UserPromptSubmit"

# 9. UMBRELLA: subagent tool (agent_id) denied in reserve
setcfg "{\"session_id\":\"$SID\",\"set_at\":$(( $(now) - 285 )),\"duration_sec\":300}"
hook "{\"session_id\":\"$SID\",\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Read\",\"agent_id\":\"sub-1\"}" | grep -q '"permissionDecision":"deny"' || fail "subagent not denied under umbrella"

# 10. token sum includes subagents
PROJ="$HOME/proj"; mkdir -p "$PROJ/sX/subagents"; MAIN="$PROJ/sX.jsonl"
printf '%s\n' '{"type":"assistant","message":{"usage":{"input_tokens":100,"output_tokens":50}}}' > "$MAIN"
printf '%s\n' '{"type":"assistant","message":{"usage":{"input_tokens":1000,"output_tokens":500}}}' > "$PROJ/sX/subagents/agent-a.jsonl"
TOK=$(node -e 'process.stdout.write(String(require("'"$BIN"'/lib.js").sumTranscriptTokens(process.argv[1])))' "$MAIN")
[ "$TOK" = "1650" ] || fail "token sum should include subagents (got $TOK)"

# 10b. REGRESSION: a TIME-ONLY budget must still sum tokens (burn-rate translation).
PROJ2="$HOME/proj2"; mkdir -p "$PROJ2"
printf '%s\n' '{"type":"assistant","message":{"usage":{"input_tokens":2000,"output_tokens":1000}}}' > "$PROJ2/t.jsonl"
setcfg "{\"session_id\":\"$SID\",\"set_at\":$(( $(now) - 30 )),\"duration_sec\":300}"
echo "{\"session_id\":\"$SID\",\"transcript_path\":\"$PROJ2/t.jsonl\",\"cost\":{\"total_cost_usd\":0.1}}" | node "$BIN/statusline.js" >/dev/null
grep -q '"tokens": 3000' "$D/$SID.state.json" || fail "time-only budget did not sum tokens: $(cat "$D/$SID.state.json")"
hook "{\"session_id\":\"$SID\",\"hook_event_name\":\"PostToolUse\"}" | grep -q "<total_tokens>" || fail "no native signal for time-only budget"

# 10c. DEADLINE OVERSHOOT MODEL: past the deadline, only ACTIVE time adds.
NOWV=$(now)
FIDLE=$(node -e 'const l=require("'"$BIN"'/lib.js");const n=+process.argv[1];console.log(l.fractions({set_at:n-120,duration_sec:60},n,{turnStart:null,overshootSec:0}).overall)' "$NOWV")
[ "$FIDLE" = "1" ] || fail "idle past deadline must freeze at 100% (got $FIDLE)"
FACTIVE=$(node -e 'const l=require("'"$BIN"'/lib.js");const n=+process.argv[1];console.log(l.fractions({set_at:n-120,duration_sec:60},n,{turnStart:n-30,overshootSec:0}).overall)' "$NOWV")
[ "$FACTIVE" = "1.5" ] || fail "active turn past deadline must climb (want 1.5, got $FACTIVE)"
# Stop closes the open turn into overshoot_sec and clears turn_start.
setcfg "{\"session_id\":\"$SID\",\"set_at\":$(( $(now) - 120 )),\"duration_sec\":60}"
setstate "{\"turn_start\":$(( $(now) - 30 )),\"overshoot_sec\":0}"
hook "{\"session_id\":\"$SID\",\"hook_event_name\":\"Stop\"}" >/dev/null
grep -q '"turn_start": null' "$D/$SID.state.json" || fail "Stop did not clear turn_start"
node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1]));process.exit(o.overshoot_sec>=25&&o.overshoot_sec<=35?0:1)' "$D/$SID.state.json" || fail "Stop overshoot accounting wrong"

# 11. ANALYTICS: SessionEnd retires a LANDED budget to history
rm -f "$D/history.jsonl"
setcfg "{\"session_id\":\"$SID\",\"set_at\":$(( $(now) - 150 )),\"duration_sec\":300}"  # 50% -> landed
setstate "{\"tokens\":10000,\"peak\":0.5}"
hook "{\"session_id\":\"$SID\",\"hook_event_name\":\"SessionEnd\"}" >/dev/null
grep -q '"landed":true' "$D/history.jsonl" || fail "SessionEnd did not log a landed outcome"
[ -f "$D/$SID.json" ] && fail "SessionEnd did not clear config" || true

# 12. ANALYTICS: an OVER-budget outcome records overshoot
setcfg "{\"session_id\":\"$SID\",\"set_at\":$(( $(now) - 360 )),\"duration_sec\":300}"  # 120%
setstate "{\"tokens\":10000,\"peak\":1.2}"
hook "{\"session_id\":\"$SID\",\"hook_event_name\":\"SessionEnd\"}" >/dev/null
grep -q '"landed":false' "$D/history.jsonl" || fail "over-budget outcome not recorded"
grep -q '"overshoot_pct":20' "$D/history.jsonl" || fail "overshoot not computed"

# 13. stats dashboard reads history
node "$BIN/dashboard.js" --once | grep -qi "landed" || fail "dashboard broken"

echo "PASS: redline v2 self-check (ledger+tiers+native signal · enforcement · umbrella · analytics)"
