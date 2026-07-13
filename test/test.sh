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
TOK=$(node -e 'process.stdout.write(String(require("'"$BIN"'/lib.js").sumTranscriptTokens(process.argv[1]).total))' "$MAIN")
[ "$TOK" = "1650" ] || fail "token sum should include subagents (got $TOK)"
# total counts cache reads; nc (what plan-% ratios use) does not
printf '%s\n' '{"type":"assistant","message":{"usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":1000}}}' > "$PROJ/nc.jsonl"
NC=$(node -e 'const s=require("'"$BIN"'/lib.js").sumTranscriptTokens(process.argv[1]);process.stdout.write(s.total+" "+s.nc)' "$PROJ/nc.jsonl")
[ "$NC" = "1150 150" ] || fail "nc split wrong (got $NC)"

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

# 10d. PLAN %: bare N% = absolute ceiling (anchored to the window's current state)
node "$BIN/set.js" "80%" "$SID" >/dev/null
grep -q '"plan_pct": 80' "$D/$SID.json" || fail "80% not parsed as plan budget"
grep -q '"plan_rel"' "$D/$SID.json" && fail "bare N% must be absolute (no plan_rel)" || true
FABS=$(node -e 'const l=require("'"$BIN"'/lib.js");console.log(l.fractions({plan_pct:80},0,{planNow:60,baselinePlan:60}).f.plan)')
[ "$FABS" = "0.75" ] || fail "ceiling: window 60% of cap 80% should be 0.75 (got $FABS)"

# 10e. PLAN %: +N% = relative allowance from the set-time baseline
node "$BIN/set.js" "+10%" "$SID" >/dev/null
grep -q '"plan_rel": true' "$D/$SID.json" || fail "+10% not parsed as relative allowance"
FREL=$(node -e 'const l=require("'"$BIN"'/lib.js");console.log(l.fractions({plan_pct:10,plan_rel:true},0,{planNow:60,baselinePlan:55}).f.plan)')
[ "$FREL" = "0.5" ] || fail "allowance: 5 of 10 points spent should be 0.5 (got $FREL)"
# window slid below baseline: fraction clamps at 0, never negative
FNEG=$(node -e 'const l=require("'"$BIN"'/lib.js");console.log(l.fractions({plan_pct:10,plan_rel:true},0,{planNow:50,baselinePlan:55}).f.plan)')
[ "$FNEG" = "0" ] || fail "plan fraction went negative (got $FNEG)"

# 10f. SENSOR: epoch-in-used_percentage (claude-code#52326) is discarded; sane readings land in plan.json
setcfg "{\"session_id\":\"$SID\",\"set_at\":$(now),\"plan_pct\":80,\"plan_window\":\"five_hour\"}"
echo "{\"session_id\":\"$SID\",\"rate_limits\":{\"five_hour\":{\"used_percentage\":1750000000}}}" | node "$BIN/statusline.js" >/dev/null
grep -q '"plan_now": null' "$D/$SID.state.json" || fail "epoch used_percentage not discarded"
echo "{\"session_id\":\"$SID\",\"rate_limits\":{\"five_hour\":{\"used_percentage\":52.4,\"resets_at\":$(( $(now) + 3600 ))}}}" | node "$BIN/statusline.js" | grep -q "27.6% left" || fail "statusline missing plan budget countdown"
grep -q '"pct": 52.4' "$D/plan.json" || fail "plan.json snapshot not written"
# +N% budget: the plan window level overlays the bar as a ▒ tail beyond the budget fill
setcfg "{\"session_id\":\"$SID\",\"set_at\":$(now),\"plan_pct\":50,\"plan_rel\":true,\"plan_window\":\"five_hour\"}"
echo "{\"session_id\":\"$SID\",\"rate_limits\":{\"five_hour\":{\"used_percentage\":52.4}}}" | node "$BIN/statusline.js" | grep -q "▒" || fail "no plan overlay in bar"
# ...and stays visible as a ▒ notch when the burn fill overtakes the plan level
setcfg "{\"session_id\":\"$SID\",\"set_at\":$(now),\"plan_pct\":50,\"plan_rel\":true,\"plan_window\":\"five_hour\"}"
setstate "{\"baseline_plan\":0,\"baseline_tokens\":0}"
OUT=$(echo "{\"session_id\":\"$SID\",\"rate_limits\":{\"five_hour\":{\"used_percentage\":30}}}" | node "$BIN/statusline.js")
echo "$OUT" | grep -q "▒" || fail "plan notch swallowed by burn fill: $OUT"
echo "$OUT" | grep -q "60%" || fail "burn should be 60% (30 of +50): $OUT"

# 10g. SENSOR: no-budget statusline still reports the plan window
rm -f "$D/$SID.json" "$D/$SID.state.json"
echo "{\"session_id\":\"$SID\",\"rate_limits\":{\"five_hour\":{\"used_percentage\":52.4}}}" | node "$BIN/statusline.js" | grep -q "plan 52%" || fail "no-budget statusline missing plan level"

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

# 13. pulse reads history (the track-record section)
node "$BIN/pulse.js" --once | grep -qi "kept you on track" || fail "pulse broken"

# 14. HEADLESS: token budget enforces with NO statusline state (hook sums transcripts itself)
setcfg "{\"session_id\":\"$SID\",\"set_at\":$(now),\"tokens\":1000}"
hook "{\"session_id\":\"$SID\",\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Bash\",\"transcript_path\":\"$PROJ2/t.jsonl\"}" | grep -q '"continue":false' || fail "headless token budget not enforced (3000 tok vs 1000 budget)"

# 15. ATTRIBUTION: pulse estimates each session's share of the plan window
setcfg "{\"session_id\":\"$SID\",\"set_at\":$(now),\"duration_sec\":600}"
setstate "{\"ts\":$(now),\"tokens\":5000}"
echo "{\"five_hour\":{\"pct\":10,\"tok_per_pct\":1000},\"ts\":$(now)}" > "$D/plan.json"
node "$BIN/pulse.js" --once | grep -q -- "~5.0% of plan" || fail "pulse missing per-session plan attribution"

# 16. DOCTOR: flags a missing/foreign statusline, passes when redline is wired
node -e 'const fs=require("fs"),os=require("os"),p=require("path");const s={statusLine:{command:"other-statusline"},hooks:{}};fs.writeFileSync(p.join(os.homedir(),".claude","settings.json"),JSON.stringify(s))'
node "$BIN/doctor.js" > /tmp/doc.$$ 2>&1 && fail "doctor should exit 1 with foreign statusline" || true
grep -q "NO live sensor" /tmp/doc.$$ || fail "doctor missed the dead-sensor case"
node -e 'const fs=require("fs"),os=require("os"),p=require("path");const h={hooks:[{type:"command",command:"redline hook"}]};const s={statusLine:{command:"redline statusline"},hooks:{PreToolUse:[h],UserPromptSubmit:[h],PostToolUse:[h],SubagentStart:[h],SessionEnd:[h],Stop:[h]}};fs.writeFileSync(p.join(os.homedir(),".claude","settings.json"),JSON.stringify(s));fs.mkdirSync(p.join(os.homedir(),".claude","commands"),{recursive:true});fs.writeFileSync(p.join(os.homedir(),".claude","commands","redline.md"),"x")'
node "$BIN/doctor.js" | grep -q "all 6 hooks wired" || fail "doctor did not pass a wired install"
rm -f /tmp/doc.$$

# 17. FORECAST: set-time echo from median burn once history has 3+ sessions
rm -f "$D/history.jsonl"
for i in 1 2 3; do echo "{\"final\":{\"tokens\":60000,\"cost_usd\":1.2,\"elapsed_sec\":600}}" >> "$D/history.jsonl"; done
node "$BIN/set.js" "10m" "$SID" | grep -q "typical burn" || fail "no forecast with 3 sessions of history"
node "$BIN/set.js" "600k" "$SID" | grep -q "≈ 100 min" || fail "token budget forecast wrong (600k at 6k tok/min should be ~100 min)"

# 18. FLEET: a global ceiling paces sessions that have NO session budget
node "$BIN/global.js" "50%" >/dev/null
rm -f "$D/$SID.json" "$D/$SID.state.json"
echo "{\"five_hour\":{\"pct\":60,\"tok_per_pct\":1000},\"ts\":$(now)}" > "$D/plan.json"  # window past the cap
hook "{\"session_id\":\"$SID\",\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Bash\"}" | grep -q '"continue":false' || fail "fleet cap not enforced on budget-less session"
echo "{\"five_hour\":{\"pct\":30,\"tok_per_pct\":1000},\"ts\":$(now)}" > "$D/plan.json"  # 60% of the cap
hook "{\"session_id\":\"$SID\",\"hook_event_name\":\"UserPromptSubmit\",\"prompt\":\"hi\"}" | grep -q "fleet" || fail "fleet missing from ledger"
echo "{\"session_id\":\"$SID\",\"rate_limits\":{\"five_hour\":{\"used_percentage\":30}}}" | node "$BIN/statusline.js" | grep -q "fleet left" || fail "no fleet statusline for budget-less session"
# stale sensor must NOT lock anyone out
echo "{\"five_hour\":{\"pct\":60},\"ts\":$(( $(now) - 3600 ))}" > "$D/plan.json"
OUT=$(hook "{\"session_id\":\"$SID\",\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Bash\"}")
[ -z "$OUT" ] || fail "stale plan reading must not enforce the fleet cap: $OUT"
node "$BIN/global.js" off >/dev/null

# 19. LANDING TELEMETRY: Stop harvests the manifest; retire records denials + clean
PROJ3="$HOME/proj3"; mkdir -p "$PROJ3"
printf '%s\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"done. LANDING: delivered the fix; cut the docs"}],"usage":{"input_tokens":10,"output_tokens":5}}}' > "$PROJ3/m.jsonl"
setcfg "{\"session_id\":\"$SID\",\"set_at\":$(( $(now) - 150 )),\"duration_sec\":300}"
setstate "{\"turn_start\":$(( $(now) - 10 )),\"overshoot_sec\":0,\"denials\":2,\"peak\":0.95,\"tokens\":100}"
hook "{\"session_id\":\"$SID\",\"hook_event_name\":\"Stop\",\"transcript_path\":\"$PROJ3/m.jsonl\"}" >/dev/null
grep -q '"landing": "delivered the fix; cut the docs"' "$D/$SID.state.json" || fail "manifest not captured on Stop"
rm -f "$D/history.jsonl"
hook "{\"session_id\":\"$SID\",\"hook_event_name\":\"SessionEnd\"}" >/dev/null
grep -q '"landing":"delivered the fix; cut the docs"' "$D/history.jsonl" || fail "manifest not in history"
grep -q '"clean":false' "$D/history.jsonl" || fail "2 denials must mean not clean"
grep -q '"landed":true' "$D/history.jsonl" || fail "peak 0.95 should still be landed"
node "$BIN/pulse.js" --once | grep -q "clean landings" || fail "pulse missing clean-landing rate"

# 20. NOTIFY toggle
node "$BIN/redline" notify on | grep -q "ON" || fail "notify on failed"
[ -f "$D/notify.on" ] || fail "notify marker not written"
node "$BIN/redline" notify off >/dev/null
[ -f "$D/notify.on" ] && fail "notify off did not remove marker" || true

echo "PASS: redline v2 self-check (ledger+tiers+native signal · enforcement · umbrella · analytics)"
