# Architecture

redline is built entirely on Claude Code's own extension points — no process wrapper, no daemon, no dependencies (just the Node that ships with Claude Code).

## Three parts

| Part | File | Role |
|---|---|---|
| **Sensor + monitor** | `bin/statusline.js` | Reads cost + plan rate-limits from the statusline feed, sums transcript tokens, draws the burn-down bar, and writes a state snapshot. |
| **Pacer + enforcer** | `bin/hook.js` | `UserPromptSubmit`/`PostToolUse`/`SubagentStart` inject live status + convergence guidance; `PreToolUse` **denies** tools in the reserve zone. |
| **Setter** | `bin/set.js` + `commands/redline.md` | `/redline …` writes the per-session budget config. |

## Data flow

```
/redline 10m $5  ──>  ~/.claude/redline/<session>.json        (budget config)
statusline render ─>  reads cost + rate_limits + transcripts
                      writes ~/.claude/redline/<session>.state.json   (snapshot)
hook (each event) ─>  reads config + snapshot
                      injects pacing  OR  denies the tool
```

The statusline is the **sensor** because its stdin is the only place cost (`cost.total_cost_usd`) and plan usage (`rate_limits.*.used_percentage`) are exposed. The hook can't see those directly, so it reads the snapshot the statusline writes. Time is computed by the hook itself from the config timestamp.

## The reserve-landing model (never over, never abrupt)

The wrap-up costs budget too, so it is **paid for from a reserve**. The stated budget is a wall redline lands *short* of:

- **WRAP (80%)** — mandatory "deliver and summarise now."
- **LOCK (90%)** — `PreToolUse` returns `permissionDecision: "deny"`, structurally blocking new tool calls. The agent can only write its final answer, which fits in the remaining reserve.
- **Ceiling (100%)** — never touched. `continue: false` (Claude Code's abrupt kill) is **deliberately never used**.

Result: lands ~90–95%, under budget, with a complete deliverable.

## Budget dimensions

| Dimension | Source | Precision |
|---|---|---|
| time | hook computes from `set_at` | best-effort (see limits) |
| `$` | `cost.total_cost_usd` | precise |
| tokens | sum of transcript usage | precise |
| plan `%` | `rate_limits` delta from baseline | precise |

Whichever dimension is closest to its limit is the **binding constraint** — the single bar tracks it, tagged with its gauge.

## Session-wide subagent umbrella

Fanned subagents (the Task/Agent tool) **share the parent's `session_id`**, so:
- `PreToolUse` fires *inside* subagents with the same session_id → the lock enforces there for free.
- `sumTranscriptTokens` also sums `<session-id>/subagents/agent-*.jsonl`, so token budgets include subagent usage.
- `SubagentStart` injects the shared budget status so subagents pace from turn 1.

One budget covers the whole session. Users never set per-subagent budgets.

## Honest limits

- **Token / $ / plan are the precise guarantee** — spend only accrues with work, and the lock catches it with reserve to spare.
- **Wall-clock time is best-effort.** The clock advances while the model generates; the lock can only fire at a tool attempt or turn boundary. On realistic budgets (minutes) checkpoints are frequent enough to land cleanly under; on absurdly tight budgets (seconds, smaller than one turn) the clock can pass the line between checkpoints. A periodic statusline-driven time guard is on the roadmap.
- **Statusline refresh caps at 1s** — Claude Code re-renders the statusline on events plus a `refreshInterval` whose minimum is 1 second; it cannot tick sub-second. For a smooth ~10×/second display use the `bin/watch.js` companion in a split pane.
- **Live $/token/plan need an interactive session** — the statusline (the sensor) doesn't render in headless `claude -p`, where only time is live.
