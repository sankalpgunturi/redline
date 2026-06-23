# Changelog

All notable changes are documented here. Format: [Keep a Changelog](https://keepachangelog.com).

## [0.1.0] - 2026-06-23
First public release.

### Added
- `/redline 10m $5` (time · `$` · `200k` tokens · `10%` plan, any combination) - set a soft budget any time.
- Live burn-down statusline + `redline dashboard` (all active budgets across sessions, live).
- Cooperative pacing via the native `<total_tokens>N tokens left</total_tokens>` signal + a tiered `<redline>` ledger every turn (mirrors the Claude Agent SDK `taskBudget` pattern; works for time/$/plan via observed-ratio translation).
- Boundary enforcement: deny tools at 90%, block new prompts once spent - never an abrupt mid-response kill.
- Session-wide budget umbrella: fanned subagents share the same budget (counted + enforced).
- Time model: wall-clock to the deadline, then only active-response time overshoots (idle freezes).
- Local analytics rolled into `redline dashboard`: "did it land within budget?" (no network).
- `redline` CLI (install / uninstall / dashboard / version); Homebrew + curl + git install.
