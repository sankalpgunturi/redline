#!/usr/bin/env bash
# redline installer. Works two ways:
#   curl -fsSL https://raw.githubusercontent.com/sankalpgunturi/redline/main/install.sh | bash
#   git clone https://github.com/sankalpgunturi/redline && cd redline && ./install.sh
set -euo pipefail
REPO_URL="https://github.com/sankalpgunturi/redline"
command -v node >/dev/null 2>&1 || { echo "redline needs Node (it ships with Claude Code). Install Node, then re-run."; exit 1; }

DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-/dev/stdin}")" 2>/dev/null && pwd || true)"
if [ -n "${DIR:-}" ] && [ -f "$DIR/bin/redline" ]; then
  ROOT="$DIR"                                   # running inside a clone
else
  ROOT="${REDLINE_HOME:-$HOME/.redline}"        # curl-piped: fetch the repo
  if [ -d "$ROOT/.git" ]; then echo "Updating redline in $ROOT…"; git -C "$ROOT" pull --quiet --ff-only || true
  else echo "Installing redline to $ROOT…"; git clone --depth 1 "$REPO_URL" "$ROOT"; fi
fi

# Put `redline` on PATH (first writable dir).
LINKED=""
for d in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin"; do
  if [ -d "$d" ] && [ -w "$d" ]; then ln -sf "$ROOT/bin/redline" "$d/redline"; LINKED="$d/redline"; break; fi
done
if [ -z "$LINKED" ]; then
  mkdir -p "$HOME/.local/bin"; ln -sf "$ROOT/bin/redline" "$HOME/.local/bin/redline"; LINKED="$HOME/.local/bin/redline"
  echo "Add ~/.local/bin to your PATH:  export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

"$ROOT/bin/redline" install
echo
echo "✅ redline ready  ('redline' -> $LINKED)"
echo "   In Claude Code:  /redline 10m \$5   ·   redline stats   ·   redline watch"
