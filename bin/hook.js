#!/usr/bin/env node
"use strict";
// redline pacer — enforces a SOFT LANDING that never exceeds the budget.
//
// The budget is an inviolable ceiling. The wrap-up costs budget too, so it is
// paid for from a RESERVE: the agent does real work only up to WRAP, then must
// deliver; at LOCK new tool calls are DENIED (PreToolUse permissionDecision:deny)
// so it physically cannot keep burning — it can only write its final answer,
// which fits in the remaining reserve. Result: lands under budget, gracefully,
// with no abrupt kill — a hard mid-response stop is deliberately never used.
//
// Wired to PreToolUse (enforce), UserPromptSubmit + PostToolUse (pace).

const lib = require("./lib.js");

const SOFT = [
  { at: 0.50, msg: "Half the budget is gone. Prioritise the core deliverable and drop optional exploration." },
  { at: 0.70, msg: "70% of the budget is used. Converge now: finish the essential path, keep tool outputs small (grep narrowly, head/tail large files, avoid re-reading whole files), and keep replies terse." },
];
const WRAP = 0.80; // mandatory landing begins: deliver + summarise, no new work
const LOCK = 0.90; // tool calls denied so the run lands inside the reserve

const landMsg =
  "Stop starting new work. Deliver your final result and a brief summary now, using what you already have. " +
  "New tool calls will be blocked at the reserve line so the session lands within budget — finish before then.";
const lockMsg =
  "🛑 redline reserve reached — tool calls are blocked to keep the session within budget. " +
  "Do NOT attempt more tools. Write your final answer/summary from what you already have, then stop.";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  let d = {};
  try { d = JSON.parse(input || "{}"); } catch {}
  const event = d.hook_event_name || "";
  const sessionId = d.session_id || "unknown";

  const cfg = lib.readJSON(lib.cfgPath(sessionId));
  if (!cfg) return; // no budget → silent

  const now = Math.floor(Date.now() / 1000);
  const st = lib.readJSON(lib.statePath(sessionId)) || {};
  const timeFrac = cfg.duration_sec ? (now - cfg.set_at) / cfg.duration_sec : 0;
  const overall = Math.max(timeFrac, st.overall || 0);
  const pct = Math.round(overall * 100);

  const left = [];
  if (cfg.duration_sec) left.push(lib.fmtDuration(Math.max(0, cfg.duration_sec - (now - cfg.set_at))) + " left");
  if (cfg.dollars) left.push("$" + Math.max(0, cfg.dollars - (st.cost_usd || 0)).toFixed(2) + " left");
  if (cfg.tokens) left.push(lib.fmtTokens(Math.max(0, cfg.tokens - (st.tokens || 0))) + " tok left");
  if (cfg.plan_pct != null && st.plan_now != null && st.baseline_plan != null) {
    left.push(Math.max(0, cfg.plan_pct - (st.plan_now - st.baseline_plan)).toFixed(1) + "% plan left");
  }
  const summary = `redline: ${pct}% of budget used (${left.join(", ")}).`;

  // ---- Enforcement: deny tools once inside the reserve zone. ----
  if (event === "PreToolUse") {
    if (overall >= LOCK) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `redline: ${pct}% — reserve reached, tools locked to land within budget.`,
          additionalContext: `${summary}\n${lockMsg}`,
        },
      }));
    }
    return; // below LOCK: allow the tool (no output)
  }

  const ctx = (text) =>
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }));

  if (event === "SubagentStart") {
    let extra = " You share this session's budget umbrella — pace accordingly.";
    if (overall >= LOCK) extra = "\n" + lockMsg;
    else if (overall >= WRAP) extra = "\n⛳ Landing zone. " + landMsg;
    ctx(summary + extra);
    return;
  }

  if (event === "UserPromptSubmit") {
    let extra = " Pace to finish within budget.";
    if (overall >= LOCK) extra = "\n" + lockMsg;
    else if (overall >= WRAP) extra = "\n⛳ Landing zone. " + landMsg;
    ctx(summary + extra);
    return;
  }

  if (event === "PostToolUse") {
    let bucket = 0;
    for (const s of SOFT) if (overall >= s.at) bucket = Math.round(s.at * 100);
    if (overall >= WRAP) bucket = Math.round(WRAP * 100);
    if (bucket <= (st.last_threshold || 0)) return; // only on a NEW threshold
    lib.writeJSON(lib.statePath(sessionId), { ...st, last_threshold: bucket });

    let msg;
    if (overall >= WRAP) msg = `⛳ Landing zone (${pct}%). ${landMsg}`;
    else for (const s of SOFT) if (Math.round(s.at * 100) === bucket) msg = s.msg;
    if (msg) ctx(`${summary}\n${msg}`);
    return;
  }
});
