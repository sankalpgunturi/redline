# redline

**Give your Claude Code session a hard budget on time and token/$ — and have it land *within* that budget, gracefully.**

You give an agent a task and lose control of two things: how *long* it runs and how *much* it burns. redline draws a line it won't cross. Set a budget at any time:

```
/redline 10m $5
```

…and you get a live burn-down in your statusline and an agent that **finishes inside the budget** — converging into a reserved landing zone and stopping with a complete deliverable, instead of either running over or getting chopped off mid-thought.

```
redline ⏱ ███████████░ 90% · ⏱ 1:00 · 💰 $1.00/$5.00
```

## The promise

Three things, no compromise:

1. **Never over.** The budget is an inviolable ceiling. Going over by even a little is a broken promise.
2. **Under is success.** Landing at 90% with the task done is a win, not a shortfall.
3. **Never abrupt.** No mid-sentence kill. It always finishes with a usable result + summary.

The trick that makes all three possible: **the wrap-up costs budget too, so it's paid for from a reserve.** redline treats your stated budget as a wall it lands *short* of:

- The agent does real work up to **80%** (`WRAP`) — then gets a *mandatory* "deliver and summarise now."
- At **90%** (`LOCK`) redline **structurally denies new tool calls** (a `PreToolUse` hook returning `permissionDecision: "deny"`). The agent physically cannot keep burning on new work or dump another file into context — it can only write its final answer, which fits in the remaining reserve.
- It lands ~90–95% with the work done. **Under. Graceful. The ceiling is never touched.**

`continue: false` (Claude Code's abrupt session kill) is **deliberately never used.** Enforcement is *structural* (blocked tools), not a polite suggestion.

## Install

Needs the Node that already ships with Claude Code. One step:

```bash
git clone https://github.com/sankalpgunturi/redline && cd redline && ./install.sh
```

Restart Claude Code. Done. (The installer backs up `~/.claude/settings.json`, never clobbers an existing statusline, appends its hooks after any you already have, and is safe to re-run.)

## Use

Set a budget on time, spend, or both — at any point in a session:

| Command | Meaning |
|---|---|
| `/redline 10m` | 10-minute budget |
| `/redline 30m $5` | 30 minutes **and** $5 |
| `/redline 1h 200k` | 1 hour **and** 200k tokens |
| `/redline 45m 10%` | 45 min **and** 10% of your 5-hour plan window |
| `/redline 10% 7d` | 10% of your 7-day plan window |
| `/redline off` | clear the budget |

Whichever dimension is closest to its limit is the **binding constraint** — the single statusline bar tracks it and is tagged with its gauge (`⏱`/`💰`/`🔤`/`📊`), so a red bar next to a still-cheap figure is never a mystery.

## How it works

Pure Claude Code extension points — no process wrapper, no daemon, no deps:

- **Statusline** (`bin/statusline.js`) — the live monitor *and* the sensor. Reads cost + plan rate-limits from the statusline feed, sums tokens from the transcript, draws the burn-down bar, and writes a snapshot the hook reads.
- **Hook** (`bin/hook.js`) — paces *and* enforces. `UserPromptSubmit`/`PostToolUse` inject the live status and escalating convergence guidance (50% → 70% → 80% landing); `PreToolUse` denies tools at the 90% reserve line.
- **Slash command** (`/redline`) — writes the budget config for the session.

## Honest limits

- **Token / $ / plan budgets are the precise guarantee.** Spend only accrues when the agent works, and the statusline snapshot updates every render, so the 90% lock catches it with reserve to spare. It lands under.
- **Wall-clock *time* is best-effort, not razor.** The clock advances while the model generates, and the lock can only fire when a tool is *attempted* or a turn boundary is hit. On realistic budgets (minutes) those checkpoints are frequent enough that it lands cleanly under; on absurdly tight budgets (seconds — smaller than one turn) the clock can pass the line between checkpoints. Time precision tracks checkpoint frequency. (A periodic statusline-driven time guard is on the roadmap.)
- The live $/token/plan dimensions only populate in **interactive** sessions — the statusline (the sensor) doesn't render in headless `claude -p`, where only the time dimension is live.

## Roadmap

- Tighter wall-clock guarantee via a statusline-driven time guard.
- Configurable reserve size (`WRAP`/`LOCK` thresholds) per budget.
- Adapters for other harnesses (Codex CLI, Cursor) — currently Claude Code only.

## License

MIT.
