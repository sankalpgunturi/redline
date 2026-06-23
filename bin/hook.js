#!/usr/bin/env node
"use strict";
// redline pacer hook. Wired to UserPromptSubmit and PostToolUse.
// - UserPromptSubmit: inject a one-line burn-down each turn so the model
//   re-grounds on how much budget is left.
// - PostToolUse: when a new threshold (50/75/90/100%) is crossed, inject
//   escalating convergence guidance. Soft only — never stops the session.

const lib = require("./lib.js");

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  let d = {};
  try { d = JSON.parse(input || "{}"); } catch {}
  const event = d.hook_event_name || "";
  const sessionId = d.session_id || "unknown";

  const cfg = lib.readJSON(lib.cfgPath(sessionId));
  if (!cfg) return; // no budget → say nothing

  const now = Math.floor(Date.now() / 1000);
  const st = lib.readJSON(lib.statePath(sessionId)) || {};

  // Time we can compute ourselves; cost/tokens/plan come from the statusline snapshot.
  const timeFrac = cfg.duration_sec ? (now - cfg.set_at) / cfg.duration_sec : 0;
  const overall = Math.max(timeFrac, st.overall || 0);
  const pct = Math.round(overall * 100);

  // Build a compact "remaining" summary.
  const left = [];
  if (cfg.duration_sec) left.push(lib.fmtDuration(Math.max(0, cfg.duration_sec - (now - cfg.set_at))) + " left");
  if (cfg.dollars) left.push("$" + Math.max(0, cfg.dollars - (st.cost_usd || 0)).toFixed(2) + " left");
  if (cfg.tokens) left.push(lib.fmtTokens(Math.max(0, cfg.tokens - (st.tokens || 0))) + " tok left");
  if (cfg.plan_pct != null && st.plan_now != null && st.baseline_plan != null) {
    left.push(Math.max(0, cfg.plan_pct - (st.plan_now - st.baseline_plan)).toFixed(1) + "% plan left");
  }
  const summary = `redline: ${pct}% of budget used (${left.join(", ")}).`;

  function emit(text) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: event, additionalContext: text },
    }));
  }

  if (event === "UserPromptSubmit") {
    emit(summary + " Keep this in mind; pace to finish the task within budget.");
    return;
  }

  if (event === "PostToolUse") {
    const bucket = pct >= 100 ? 100 : pct >= 90 ? 90 : pct >= 75 ? 75 : pct >= 50 ? 50 : 0;
    if (bucket <= (st.last_threshold || 0)) return; // only fire on a NEW threshold

    lib.writeJSON(lib.statePath(sessionId), { ...st, last_threshold: bucket });

    const msg = {
      50: "Half the budget is gone. Make sure the remaining work fits — prioritise the core deliverable over polish and stop any optional exploration.",
      75: "75% of the budget is used. Start converging: finish the essential path now, defer or drop nice-to-haves, keep tool outputs small (grep narrowly, head/tail large files, avoid re-reading whole files), and keep responses terse.",
      90: "90% of the budget is used. Wrap up now — complete and verify the minimal working result, do not start new work or refactors.",
      100: "Budget is spent. Deliver what is working right now and summarise clearly, noting anything left undone. Do not begin new work or expand scope.",
    }[bucket];
    if (msg) emit(`${summary}\n${msg}`);
    return;
  }
});
