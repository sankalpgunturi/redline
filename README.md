<p align="center">
  <img src="assets/banner.svg" alt="redline — land within budget" width="100%">
</p>

<p align="center">
  <b>Hard time + token/$ budgets for Claude Code.</b><br>
  Your agent paces itself to land <i>within</i> the line — never over, never an abrupt kill.
</p>

<p align="center">
  <a href="docs/ARCHITECTURE.md">Architecture</a> ·
  <a href="docs/CONTRIBUTING.md">Contributing</a> ·
  <a href="docs/SECURITY.md">Security</a> ·
  <a href="docs/ARCHITECTURE.md#honest-limits">Limits</a> ·
  <a href="assets/showcase.html">Animated demo</a>
</p>

---

## What it does

Set a budget any time:

```
/redline 10m $5
```

Live burn-down in your statusline, and an agent that converges to finish inside it:

```
redline  ⏱ ███████████░ 90%  ·  ⏱ 1:00  ·  💰 $1.00/$5.00
```

**The promise** — [why it holds →](docs/ARCHITECTURE.md#the-reserve-landing-model-never-over-never-abrupt)

- 🔴 **Never over** — the budget is an inviolable ceiling.
- 🏁 **Under is success** — lands ~90% with the task done.
- 🪂 **Never abrupt** — always finishes with a usable result; no mid-sentence kill.

> One budget covers everything the session spawns — **fanned subagents share the same umbrella**, counted *and* enforced. You never budget a subagent separately. [How →](docs/ARCHITECTURE.md#session-wide-subagent-umbrella)

## Install

```bash
git clone https://github.com/sankalpgunturi/redline && cd redline && ./install.sh
```

Restart Claude Code. Backs up your settings, never clobbers an existing statusline, safe to re-run.

## Use

| Command | Budget |
|---|---|
| `/redline 10m` | 10 minutes |
| `/redline 30m $5` | 30 min **+** $5 |
| `/redline 1h 200k` | 1 hour **+** 200k tokens |
| `/redline 45m 10%` | 45 min **+** 10% of your plan |
| `/redline off` | clear |

Whichever dimension is closest to its limit drives the bar (tagged with its gauge).

### Watch it live

The statusline refreshes once a second (Claude Code's hard cap). For a smooth, ~10×/second countdown with tenths and a sub-character bar, run the watcher in a split pane next to Claude Code:

```bash
node ~/redline/bin/watch.js      # follows your latest /redline budget
```

---

<p align="center"><sub>MIT © redline contributors · built on Claude Code's native hooks + statusline, zero dependencies</sub></p>
