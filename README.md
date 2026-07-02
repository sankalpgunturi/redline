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

**npm** (package is `redline-cc` - `redline` was already taken on npm; the installed command is still `redline`)
```bash
npm install -g redline-cc && redline install
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
| `/redline 45m 10%` | 45 min and 10% of your plan |
| `/redline off` | clear |

Whichever dimension is closest to its limit drives the bar (tagged with its gauge). Each one counts down, like `⏱ 1:00 left` and `💰 $1.85 left`.

## Commands

| Command | What |
|---|---|
| `redline pulse` | all your active budgets, live, plus the landed-rate (local, no network) |
| `redline uninstall` | remove redline from Claude Code |
| `redline version` | |

## Pulse

Every active budget across your sessions, live, plus the one number that matters: did the session land within budget? All local, no network.

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
