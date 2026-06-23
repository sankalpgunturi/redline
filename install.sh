#!/usr/bin/env bash
# redline installer — wires the statusline, hooks, and /redline command into Claude Code.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null 2>&1 || { echo "node is required (it ships with Claude Code)"; exit 1; }
node "$DIR/bin/install.js"
