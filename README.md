# redline

**Give your Claude Code session a time and token/$ budget — and watch it pace itself to land within it.**

You give an agent a task and lose control of two things: how *long* it runs and how *much* it burns. redline puts both on a leash. Set a budget at any time:

```
/redline 10m $5
```

…and you get a live burn-down in your statusline plus an agent that's continuously reminded of the limit and steered to **finish the task within it** — converging gracefully as the budget depletes instead of getting chopped off mid-thought.

```
redline ███████░░░░░ 58% · ⏱ 4:12 · 💰 $2.90/$5.00 · 📊 6.1/10%
```

## Install

Needs the Node that already ships with Claude Code. One step:

```bash
git clone https://github.com/sankalpgunturi/redline && cd redline && ./install.sh
```

Restart Claude Code. Done. (The installer backs up `~/.claude/settings.json`, never clobbers an existing statusline, and is safe to re-run.)

## Use

Set a budget on time, spend, or both — at any point in a session:

| Command | Meaning |
|---|---|
| `/redline 10m` | 10-minute time budget |
| `/redline 30m $5` | 30 minutes **and** $5 |
| `/redline 1h 200k` | 1 hour **and** 200k tokens |
| `/redline 45m 10%` | 45 min **and** 10% of your 5-hour plan window |
| `/redline 10% 7d` | 10% of your 7-day plan window |
| `/redline off` | clear the budget |

Whichever dimension is closest to its limit drives the pacing. The statusline updates live; the agent gets a status line every turn and escalating "converge / wrap up" nudges at 50 / 75 / 90 / 100%.

## How it works

Pure Claude Code extension points — no process wrapper, no daemon, no deps:

- **Statusline** (`bin/statusline.js`) — the live monitor *and* sensor. Reads cost and plan rate-limits from the statusline feed, sums tokens from the transcript, renders the bar, and writes a snapshot the hook reads.
- **Hook** (`bin/hook.js`) — the pacer. On every turn it injects the remaining budget; at each new threshold it injects convergence guidance (including "keep tool outputs small" — the main source of burn the model didn't choose).
- **Slash command** (`/redline`) — writes the budget config for the session.

## The honest part: it's a *soft* governor, not a circuit breaker

A model can't precisely control its own burn — it doesn't know how many tokens a reply will take, a verbose tool result dumps unpredictably into context, and it has no exact internal "stop." redline works *with* that by making the agent **budget-aware and self-converging**:

1. a budget-shaped plan up front (the biggest lever),
2. an accurate budget signal every turn,
3. escalating "converge / shrink tool output / wrap up" guidance,
4. a strong "deliver and stop" at 100%.

This pulls runs much closer to a target than the status-quo of *zero* signal — but it can still overshoot the line somewhat. The only *guaranteed* ceiling is a hard stop, which is intentionally **not** the default (it produces the abrupt cutoffs this tool exists to avoid). A `--hard` opt-in for the "30 minutes to submit, no excuses" case is on the roadmap.

## Roadmap

- `--hard` flag for a guaranteed stop at 100%.
- Adapters for other harnesses (Codex CLI, Cursor) — currently Claude Code only.
- Per-phase budget allocation.

## License

MIT.
