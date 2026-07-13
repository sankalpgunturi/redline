# Changelog

All notable changes are documented here. Format: [Keep a Changelog](https://keepachangelog.com).

## [0.4.0] - 2026-07-13

### Added
- npm distribution: `npm install -g redline-cc` (first npm release; the installed command stays `redline`). Publish wired into the release workflow with provenance. Contributed by @Harshithnelagiri (#9).
- Budget parser hardening: decimal time units (`2.5h`), and whole-spec rejection of negative/zero/garbage budgets with a clear error - no partial applies. Plus a dedicated 50-case parser suite in CI. Contributed by @Harshithnelagiri (#9).
- Windows-safe dispatcher resolution in the installer (PATH scan instead of a bash shell-out) (#9).

### Changed
- CI actions bumped: checkout v7, setup-node v6 (#1, #2).

## [0.3.1] - 2026-07-13

### Changed
- Website tells the v0.3 story: plan-aware ceilings, fleet budget, graded landings, tokens-per-1%.
- Release workflow: tap bump is idempotent and automated via TAP_GITHUB_TOKEN.

## [0.3.0] - 2026-07-13

### Added
- **Fleet budget**: `redline global 60%` (or `/redline global 60%`) sets a machine-wide ceiling on the shared plan window. Every session - budgeted or not - paces and lands softly against it; statusline shows a `🌐` bar, pulse shows the cap. Stale sensor readings (>15 min) never enforce.
- **Landing telemetry**: reserve-zone denials are counted (`clean` landing = the model wrapped up before the lock fired), and the model ends budget-pressed sessions with a `LANDING: delivered X; cut Y` manifest that the Stop hook harvests into history. Pulse shows the clean-landing rate and the last manifest.
- **Notifications** (opt-in, macOS): `redline notify on` pings when any session crosses the 70% landing zone or the 90% reserve.
- Release workflow now bumps the Homebrew tap automatically (requires a `TAP_GITHUB_TOKEN` repo secret; skips gracefully without it).

### Changed
- Tokens-per-1%-of-plan is now computed from non-cache tokens (input + output + cache creation). Cache reads barely count against the limiter and were inflating the ratio to absurdity (1% ≈ 11M).

## [0.2.0] - 2026-07-02

### Changed
- **BREAKING: plan `%` budgets are now absolute ceilings.** `/redline 80%` means "stop when the window hits 80% used" - anchored to your plan's current state, so a half-burned window shows up half-burned instead of a bar that starts at 0%. The old relative semantic ("N more points from now") moved to `/redline +N%`.

### Added
- Plan-window sensor: every statusline render persists the latest `rate_limits` reading (`used_percentage`, `resets_at`) to `~/.claude/redline/plan.json`.
- `/redline 80%` echoes where your window sits right now, your headroom to the ceiling, and warns if you're already past it.
- The statusline bar now overlays the plan window into the budget track: solid fill = this session's budget burn, dim `▒` tail = where the shared plan window sits, one bar instead of two competing percentages. With no budget set, the bar shows the plan level growing (`▒░░… plan 7% ↺4:35`). Reset countdown (`↺`) rides on the plan segment.
- Observed tokens-per-1%-of-plan in `redline pulse` and the set-time echo (`1% ≈ 85k tok`) - the number the usage page doesn't tell you.
- `redline pulse` gained a PLAN WINDOW section: each window's level, reset countdown, and token cost per 1%.

- Headless enforcement: token budgets now work in `claude -p`, CI, and background jobs - when no statusline sensor is running, the hook sums transcripts itself.
- Per-session plan attribution in `redline pulse`: estimates each live session's share of the shared plan window (`~3.1% of plan`) from its token count and the observed tokens-per-1%.
- `redline doctor`: checks hooks, the statusline sensor (the classic silent failure: a kept third-party statusline means $/plan budgets have no feed), the /redline command, and the plan-window reading.
- Set-time forecast: with 3+ finished sessions in history, `/redline` echoes what the budget buys at your median burn ("this budget ≈ 25 min of work").

### Fixed
- `used_percentage` readings outside 0-100 (claude-code#52326 sends an epoch timestamp when the window is empty) are discarded instead of poisoning the baseline.

## [0.1.1] - 2026-06-23

### Changed
- `dashboard` / `watch` / `stats` consolidated into one **`redline pulse`**: every active budget across your sessions, live, plus how often you stayed on track (`stats` kept as an alias).
- Banner and website now feature the **tachometer** (the needle revs up and stops just short of the redline).
- Past a time budget's deadline, only active response time counts as overshoot; idle no longer inflates "over".
- Statusline and pulse count down (`$1.85 left`); plain copy, no em dashes.

### Fixed
- `/redline $5` no longer silently cleared the budget (the shell was eating the `$`).
- Empty `/redline` shows status instead of clearing.

## [0.1.0] - 2026-06-23
First public release.

### Added
- `/redline 10m $5` (time · `$` · `200k` tokens · `10%` plan, any combination) - set a soft budget any time.
- Live burn-down statusline + `redline pulse` (all active budgets across sessions, live).
- Cooperative pacing via the native `<total_tokens>N tokens left</total_tokens>` signal + a tiered `<redline>` ledger every turn (mirrors the Claude Agent SDK `taskBudget` pattern; works for time/$/plan via observed-ratio translation).
- Boundary enforcement: deny tools at 90%, block new prompts once spent - never an abrupt mid-response kill.
- Session-wide budget umbrella: fanned subagents share the same budget (counted + enforced).
- Time model: wall-clock to the deadline, then only active-response time overshoots (idle freezes).
- Local analytics rolled into `redline pulse`: "did it land within budget?" (no network).
- `redline` CLI (install / uninstall / pulse / version); Homebrew + curl + git install.
