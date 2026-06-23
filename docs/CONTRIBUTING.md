# Contributing

PRs welcome. redline is intentionally tiny and dependency-free — keep it that way.

## Layout

```
bin/statusline.js   sensor + burn-down bar
bin/hook.js         pacer + enforcer
bin/set.js          /redline parser + config writer
bin/lib.js          shared helpers (config, token-sum, formatting)
bin/install.js      settings.json merge + command install
commands/redline.md generated slash command (installer writes it)
test/test.sh        self-check (no framework)
```

## Run the checks

```bash
bash test/test.sh
```

It exercises set → statusline → hook end to end, including the reserve-landing
enforcement and the subagent umbrella. No frameworks, no fixtures.

## Testing live

Wire the hooks via a throwaway `--settings` file and run a headless session with
`claude -p … --output-format stream-json --verbose`. Pre-seed a budget at
`~/.claude/redline/<session>.json` and watch hook output. (Statusline doesn't
render headlessly, so only time is live there — see [Architecture](ARCHITECTURE.md#honest-limits).)

## Principles

- Zero dependencies; use the bundled Node only.
- No `continue: false` — enforcement is structural (tool-deny), never an abrupt kill.
- Shortest working diff. Mark deliberate simplifications in comments.

## Roadmap

- Tighter wall-clock guarantee (statusline-driven time guard).
- Configurable reserve / WRAP / LOCK thresholds per budget.
- Adapters for other harnesses (Codex CLI, Cursor).
