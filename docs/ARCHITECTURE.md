# Architecture

redline is built entirely on Claude Code's own extension points - no process wrapper, no daemon, no dependencies (just the Node that ships with Claude Code).

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

- **WRAP (80%)** - mandatory "deliver and summarise now."
- **LOCK (90%)** - `PreToolUse` returns `permissionDecision: "deny"`, structurally blocking new tool calls. The agent can only write its final answer, which fits in the remaining reserve.
- **Ceiling (100%)** - never touched. `continue: false` (Claude Code's abrupt kill) is **deliberately never used**.

Result: lands ~90–95%, under budget, with a complete deliverable.

## Budget dimensions

| Dimension | Source | Precision |
|---|---|---|
| time | hook computes from `set_at` | best-effort (see limits) |
| `$` | `cost.total_cost_usd` | precise |
| tokens | sum of transcript usage | precise |
| plan `%` | `rate_limits` delta from baseline | precise |

Whichever dimension is closest to its limit is the **binding constraint** - the single bar tracks it, tagged with its gauge.

## Session-wide subagent umbrella

Fanned subagents (the Task/Agent tool) **share the parent's `session_id`**, so:
- `PreToolUse` fires *inside* subagents with the same session_id → the lock enforces there for free.
- `sumTranscriptTokens` also sums `<session-id>/subagents/agent-*.jsonl`, so token budgets include subagent usage.
- `SubagentStart` injects the shared budget status so subagents pace from turn 1.

One budget covers the whole session. Users never set per-subagent budgets.

## Honest limits

- **Token / $ / plan are the precise guarantee** - spend only accrues with work, and the lock catches it with reserve to spare.
- **Wall-clock time is best-effort.** The clock advances while the model generates; the lock can only fire at a tool attempt or turn boundary. On realistic budgets (minutes) checkpoints are frequent enough to land cleanly under; on absurdly tight budgets (seconds, smaller than one turn) the clock can pass the line between checkpoints. A periodic statusline-driven time guard is on the roadmap.
- **Statusline refresh caps at 1s** - Claude Code re-renders the statusline on events plus a `refreshInterval` whose minimum is 1 second; it cannot tick sub-second. For a live multi-session view (and a smoother display) run `redline dashboard` in a split pane.
- **Live $/token/plan need an interactive session** - the statusline (the sensor) doesn't render in headless `claude -p`, where only time is live.

## Mirroring Anthropic's `taskBudget`

The Claude Agent SDK has `taskBudget` (alpha): it sends `output_config.task_budget` with a beta header so the **model itself** is made aware of its remaining token budget and paces tool use / wraps up before the limit. The Claude Code **CLI does not expose this** - and Anthropic has little incentive to add a *spend-less* cap (especially a time one). That gap is redline's reason to exist.

We replicate the **client-side** half of the same mechanism (the SDK's internal `totalTokensReminder`): inject a `<total_tokens>N tokens left</total_tokens>` block every turn + after every tool result. The model is **natively tuned to that exact signal**, so emitting it ourselves piggybacks on Anthropic's own budget-pacing training.

Since their signal is tokens-only, redline **translates every budget dimension into a tokens-left figure** using the session's own observed ratios (`$ → tokens` via observed $/token, `time → tokens` via observed tokens/sec burn-rate, `plan% → tokens` via observed tokens/%), and emits the *binding* dimension. This is how a **wall-clock deadline** drives the model's native token-pacing - something Anthropic's budget machinery has no concept of.

Important: `taskBudget` is only the *cooperative* layer ("pace and wrap up") - it's awareness, not a hard cap. redline adds the coercive boundary layer (deny / block / halt) the SDK leaves to `maxBudgetUsd` / `maxTurns`.

## Analytics

Every retiring budget logs one outcome line to `~/.claude/redline/history.jsonl` (append-only, local only, no network) - on `SessionEnd`, `/redline off`, or a new `/redline`. The one metric: **did peak usage stay ≤ 100% (landed) or not.** Record shape: `{budget, peak, final, landed, overshoot_pct, reason}`. View with:

```bash
redline dashboard          # live: active budgets + landed-rate
redline dashboard --json   # raw history records
```

## Time model: wall-clock to the deadline, active-only past it

A time budget is **wall-clock up to the deadline** - it counts reading, thinking, and idle, because the task spans many prompts and the deadline is real. **Past** the deadline the meter only climbs while Claude is *actively responding* (a turn in progress); idle-past-deadline **freezes** it. So "over budget" means Claude kept working past the line, not that you sat reading after time ran out.

Mechanics: `UserPromptSubmit` stamps `turn_start`; `Stop` closes the turn, adding any past-deadline span to `overshoot_sec`; `lib.timeUsedSec` = `min(elapsed, duration) + overshoot_sec (+ live in-flight past-deadline span)`. Because new prompts are blocked past 100%, the only overshoot is the turn that straddles the deadline.

## How each dimension is measured

| Dimension | Source | Notes |
|---|---|---|
| **time** | wall-clock + active overshoot (above) | the only dimension affected by idle |
| **$** | Claude Code's `cost.total_cost_usd` (statusline feed) | client-side **estimate**, session-wide (incl. subagents), only moves during turns. Not a bill - on Max it's API-equivalent. |
| **tokens** | summed from transcripts (main + subagents) | redline's own count; independent of the `$` source |
| **plan %** | `rate_limits.*.used_percentage` delta from baseline | five_hour or seven_day window |

Money needs no idle handling: cost only accrues when a prompt is sent, so it never inflates between prompts.
