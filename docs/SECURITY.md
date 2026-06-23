# Security

redline runs locally inside Claude Code. It makes **no network calls**, has **no telemetry**, and nothing leaves your machine.

## What it touches

- `~/.claude/settings.json` - adds its statusline + hooks. Backed up to `settings.json.bak` on install; never clobbers an existing statusline; appends after your existing hooks.
- `~/.claude/redline/` - per-session budget config + state snapshots (small JSON).
- Reads session transcripts (`~/.claude/projects/…/*.jsonl`) **only to sum token-usage fields**. It parses the JSON for `usage` numbers and timestamps; it does not transmit transcript contents anywhere.

## How enforcement works

The budget ceiling is enforced via a `PreToolUse` hook returning
`permissionDecision: "deny"` - a first-class part of Claude Code's permission
system. redline never uses `continue: false` (the abrupt session kill).

## Reporting

Found a problem? Open an issue, or for anything sensitive, contact the maintainer
privately before public disclosure.
