#!/usr/bin/env bash
# 50 use-case suite for the budget parser (bin/set.js). Complements test/test.sh
# (which covers the ledger/hook/statusline/analytics pipeline end to end) with
# focused coverage of every input shape the parser accepts or must reject -
# formats, combinations, case-insensitivity/disambiguation, unit boundaries,
# clear/status paths, and Phase 2 hardening (reject negative/zero/garbage,
# never partially apply a spec that has any bad token in it).
set -euo pipefail
export NO_COLOR=1 FORCE_COLOR=0
BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/../bin" && pwd)"
export HOME="$(mktemp -d)"; trap 'rm -rf "$HOME"' EXIT
D="$HOME/.claude/redline"
N=0; FAILED=0
# N must be incremented in the current shell, not a $(...) subshell (whose
# variable changes don't survive), so callers do `next; s="case$N"` inline.
next() { N=$((N + 1)); }

# run <sid> <args> -> sets OUT, RC (the && / || keeps this safe under `set -e`
# even when the invoked command exits non-zero, which every reject case does)
run() { OUT=$(node "$BIN/set.js" "$2" "$1" 2>&1) && RC=0 || RC=$?; }

report() { if [ "$1" = "ok" ]; then :; else FAILED=$((FAILED + 1)); echo "FAIL (#$N '$2'): $3"; fi; }

# --- assertion helpers -------------------------------------------------------

expect_json() { # expect_json <args> <grep-pattern...> - one fresh session, expect success
  next; local s="case$N"; run "$s" "$1"; shift
  if [ "$RC" -ne 0 ]; then report fail "$1" "expected exit 0, got $RC :: $OUT"; return; fi
  for pat in "$@"; do
    grep -q "$pat" "$D/$s.json" 2>/dev/null || { report fail "$1" "expected '$pat' in config, got: $(cat "$D/$s.json" 2>/dev/null)"; return; }
  done
  report ok
}

expect_clear() { # expect_clear <args>
  next; local s="case$N"; run "$s" "$1"
  [ "$RC" -eq 0 ] || { report fail "$1" "expected exit 0, got $RC :: $OUT"; return; }
  echo "$OUT" | grep -qi "cleared" || { report fail "$1" "expected 'cleared' message, got: $OUT"; return; }
  if [ -f "$D/$s.json" ]; then report fail "$1" "expected no config file after clear"; return; fi
  report ok
}

expect_status_no_crash() { # expect_status_no_crash <args> - empty/status path, just must not throw
  next; local s="case$N"; run "$s" "$1"
  [ "$RC" -eq 0 ] || { report fail "$1" "expected exit 0 for status path, got $RC :: $OUT"; return; }
  report ok
}

expect_reject() { # expect_reject <args> - fresh session, must reject and write nothing
  next; local s="case$N"; run "$s" "$1"
  [ "$RC" -ne 0 ] || { report fail "$1" "expected non-zero exit, got 0 :: $OUT"; return; }
  echo "$OUT" | grep -qi "couldn't parse" || { report fail "$1" "expected 'couldn't parse' message, got: $OUT"; return; }
  if [ -f "$D/$s.json" ]; then report fail "$1" "expected no config file to be written"; return; fi
  report ok
}

expect_reject_preserves() { # expect_reject_preserves <args> - existing valid config must survive untouched
  next; local s="case$N"
  node "$BIN/set.js" "5m \$1" "$s" >/dev/null
  local before; before=$(cat "$D/$s.json")
  run "$s" "$1"
  [ "$RC" -ne 0 ] || { report fail "$1" "expected non-zero exit, got 0 :: $OUT"; return; }
  local after; after=$(cat "$D/$s.json")
  [ "$before" = "$after" ] || { report fail "$1" "existing config was modified by a rejected spec"; return; }
  report ok
}

# --- 1-12: time formats -------------------------------------------------------
expect_json "10m" '"duration_sec": 600'
expect_json "1h" '"duration_sec": 3600'
expect_json "45s" '"duration_sec": 45'
expect_json "1d" '"duration_sec": 86400'
expect_json "2.5h" '"duration_sec": 9000'
expect_json "0.5d" '"duration_sec": 43200'
expect_json "0.1h" '"duration_sec": 360'
expect_json "90m" '"duration_sec": 5400'
expect_json "1h30m" '"duration_sec": 5400'
expect_json "2h30m15s" '"duration_sec": 9015'
expect_json "30m 30m" '"duration_sec": 3600'      # two tokens accumulate
expect_json "2.5H" '"duration_sec": 9000'          # case-insensitive unit

# --- 13-14: m (minutes) vs M (million tokens) disambiguation -----------------
expect_json "1.5m" '"duration_sec": 90'
expect_json "1.5M" '"tokens": 1500000'

# --- 15-18: dollar amounts ----------------------------------------------------
expect_json "\$5" '"dollars": 5'
expect_json "\$0.5" '"dollars": 0.5'
expect_json "\$0.01" '"dollars": 0.01'
expect_json "\$100" '"dollars": 100'

# --- 19-25: token amounts + unit boundary -------------------------------------
expect_json "200k" '"tokens": 200000'
expect_json "100K" '"tokens": 100000'              # case-insensitive k
expect_json "2.5k" '"tokens": 2500'
expect_json "1M" '"tokens": 1000000'
expect_json "0.001M" '"tokens": 1000'
expect_json "150000" '"tokens": 150000'            # bare integer
expect_json "1000" '"tokens": 1000'                # bare-integer boundary (>=1000)

# --- 26-30: plan percent + 7-day window ---------------------------------------
expect_json "10%" '"plan_pct": 10' '"plan_window": "five_hour"'
expect_json "0.5%" '"plan_pct": 0.5'
expect_json "99.9%" '"plan_pct": 99.9'
expect_json "10% 7d" '"plan_pct": 10' '"plan_window": "seven_day"'
expect_json "10%7d" '"plan_pct": 10' '"plan_window": "seven_day"'  # combined single token

# --- 31-36: multi-dimension combinations --------------------------------------
expect_json "30m \$5" '"duration_sec": 1800' '"dollars": 5'
expect_json "1h 200k" '"duration_sec": 3600' '"tokens": 200000'
expect_json "45m 10%" '"duration_sec": 2700' '"plan_pct": 10'
expect_json "30m \$5 200k" '"duration_sec": 1800' '"dollars": 5' '"tokens": 200000'
expect_json "1h \$10 500k 20%" '"duration_sec": 3600' '"dollars": 10' '"tokens": 500000' '"plan_pct": 20'
expect_json "45m 10% 7d" '"duration_sec": 2700' '"plan_pct": 10' '"plan_window": "seven_day"'

# --- 37-40: clear + status paths ----------------------------------------------
expect_clear "off"
expect_clear "clear"
expect_clear "cancel"
expect_status_no_crash ""

# --- 41-50: Phase 2 hardening - reject negative/zero/garbage/malformed -------
expect_reject "-100"
expect_reject "-5m"
expect_reject "abc"
expect_reject "\$0"
expect_reject "0m"
expect_reject "0%"
expect_reject "0k"
expect_reject "\$-5"
expect_reject ".5h"
expect_reject_preserves "5m abc"   # mixed valid+garbage: whole spec rejected, prior config untouched

echo
if [ "$FAILED" -eq 0 ]; then
  echo "PASS: parser-cases ($N/$N)"
else
  echo "FAILED: $FAILED/$N parser cases"
  exit 1
fi
