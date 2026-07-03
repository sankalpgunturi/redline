<p align="center">
  <img src="assets/banner.svg" alt="redline: token and time budgeting for Claude Code" width="100%">
</p>

<p align="center">
  <b>Token and time budgeting for Claude Code.</b><br>
  Set a limit. redline paces the session to finish inside it, and stops it before it runs over.
</p>

<p align="center">
  <a href="https://www.producthunt.com/products/redline-5"><img src="https://img.shields.io/badge/Product%20Hunt-redline-da552f.svg?logo=producthunt&logoColor=white" alt="Product Hunt"></a>
  <a href="https://github.com/sankalpgunturi/redline/actions/workflows/ci.yml"><img src="https://github.com/sankalpgunturi/redline/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fredline-counter.sgunturi.workers.dev%2Fbadge" alt="installs">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT">
  <img src="https://img.shields.io/badge/dependencies-zero-brightgreen.svg" alt="zero dependencies">
  <img src="https://img.shields.io/badge/Claude%20Code-native%20hooks-d97757.svg" alt="Claude Code native">
</p>

<p align="center">
  <a href="https://sankalpgunturi.github.io/redline">Website</a> ·
  <a href="docs/ARCHITECTURE.md">Architecture</a> ·
  <a href="docs/CONTRIBUTING.md">Contributing</a> ·
  <a href="docs/SECURITY.md">Security</a> ·
  <a href="docs/ARCHITECTURE.md#honest-limits">Limits</a> ·
  <a href="https://youtu.be/LBGoEirTrF0">Demo</a>
</p>

---

## What it does

Set a budget any time, inside Claude Code:

```
/redline 10m $5
```

You get a live burn-down in your statusline, and an agent that paces itself to finish inside it:

```
redline  ████████████  ⏱ 1:00  ·  💰 $1.85 left
```

**The promise** ([why it holds](docs/ARCHITECTURE.md#the-reserve-landing-model-never-over-never-abrupt)):

- 🔴 **Never over.** The budget is a hard ceiling.
- 🏁 **Under is success.** It lands around 90% with the task done.
- 🪂 **Never abrupt.** It always finishes with a usable result. No mid-sentence kill.

> One budget covers everything the session spawns. Fanned subagents share the same umbrella, counted and enforced. You never budget a subagent separately. [How it works](docs/ARCHITECTURE.md#session-wide-subagent-umbrella).

> Works with Claude Code today. Codex and other agents are on the roadmap.

## Install

Needs the Node that ships with Claude Code. Pick one, then restart Claude Code:

**Homebrew**
```bash
brew install sankalpgunturi/redline/redline && redline install
```

**curl**
```bash
curl -fsSL https://raw.githubusercontent.com/sankalpgunturi/redline/main/install.sh | bash
```

**git**
```bash
git clone https://github.com/sankalpgunturi/redline && cd redline && ./install.sh
```

It backs up your settings, never clobbers an existing statusline, and is safe to re-run. Remove anytime with `redline uninstall`.

## Use

| Command | Budget |
|---|---|
| `/redline 10m` | 10 minutes |
| `/redline $5` | $5 |
| `/redline 30m $5` | 30 min and $5 |
| `/redline 1h 200k` | 1 hour and 200k tokens |
| `/redline 80%` | plan ceiling: stop when your 5-hour window hits 80% used |
| `/redline +10%` | plan allowance: spend 10 more points of the window from now |
| `/redline 80% 7d` | ceiling on the 7-day window instead |
| `/redline off` | clear |

Whichever dimension is closest to its limit drives the bar (tagged with its gauge). Each one counts down, like `⏱ 1:00 left` and `💰 $1.85 left`.

Plan `%` budgets are anchored to your plan's **current state**: `/redline 80%` when the window is already 52% used starts the bar at 52/80, shows the absolute window level plus its reset countdown (`plan 52% ↺1:23`), and tells you your headroom when you set it. Even with no budget set, the statusline shows where your window sits. As a bonus, redline observes what 1% of *your* plan actually costs in tokens (`1% ≈ 85k tok` in `redline pulse`) - the number the usage page doesn't tell you.

## Commands

| Command | What |
|---|---|
| `redline pulse` | all your active budgets, live, plus the landed-rate (local, no network) |
| `redline doctor` | check the wiring: hooks, statusline sensor, plan feed |
| `redline uninstall` | remove redline from Claude Code |
| `redline version` | |

## Pulse

Every active budget across your sessions, live, plus the one number that matters: did the session land within budget? All local, no network. When you run several sessions at once, pulse also estimates each session's share of the shared plan window (`~3.1% of plan`), so you can see which one is eating it.

```bash
redline pulse
```
```
  redline · did it land within budget?
  ██████████████░░░░░░░░░░  60% landed  (3/5 sessions)
  landed ≤100%: 3     over budget: 2 · avg overshoot 21%
```

---

<p align="center"><sub>MIT © redline contributors · built on Claude Code's native hooks and statusline · zero dependencies</sub></p>
