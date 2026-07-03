#!/usr/bin/env node
"use strict";
// redline pacer + enforcer (CLI v2.1).
// Cooperative: native <total_tokens> signal + <redline> ledger (tiers) every turn.
// Coercive: PreToolUse deny@90 -> continue:false@100 ; UserPromptSubmit block@100.
// Time model: wall-clock to the deadline; PAST it, only ACTIVE response time adds
// (Stop closes each turn's past-deadline overshoot), so idle never inflates "over".

const lib = require("./lib.js");
const LOW = 0.70, LOCK = 0.90, CEIL = 1.0;

function tier(o) {
  if (o >= CEIL) return { tag: "OVER", line: "Budget spent - stop. Do not start new work; do not run tools." };
  if (o >= LOCK) return { tag: "RESERVE", line: "Reserve zone: tool calls are LOCKED. Write your final answer/result from what you already have, then stop." };
  if (o >= LOW)  return { tag: "LOW", line: "Ship the minimal result NOW: stop exploring, drop nice-to-haves, keep tool outputs small (grep narrowly, head/tail, don't re-read whole files), deliver + summarise. If you cannot finish in the remaining budget, say so and cut scope." };
  if (o >= 0.30) return { tag: "MEDIUM", line: "Targeted work only - spend budget on steps that change your next action; limit exploration." };
  return { tag: "HIGH", line: "Explore as needed, but keep the budget in view." };
}

function closeTurn(cfg, st, now) {
  if (!st.turn_start) return st;
  const deadline = cfg.set_at + (cfg.duration_sec || 0);
  const add = cfg.duration_sec && now > deadline ? Math.max(0, now - Math.max(st.turn_start, deadline)) : 0;
  return { ...st, turn_start: null, overshoot_sec: (st.overshoot_sec || 0) + add };
}

function ledger(cfg, st, now) {
  const r = { costUsd: st.cost_usd || 0, tokens: st.tokens || 0, planNow: st.plan_now, baselinePlan: st.baseline_plan, turnStart: st.turn_start, overshootSec: st.overshoot_sec };
  const { overall } = lib.fractions(cfg, now, r);
  const pct = Math.round(overall * 100);
  const rate = lib.burnRate(st, cfg, now);
  const dims = [];
  if (cfg.duration_sec != null) {
    const used = lib.timeUsedSec(cfg, now, st.turn_start, st.overshoot_sec);
    dims.push(`⏱ ${lib.fmtDuration(Math.max(0, cfg.duration_sec - used))} left` + (rate ? ` (~${lib.fmtTokens(rate)} tok/s)` : ""));
  }
  if (cfg.dollars != null) dims.push(`$${Math.max(0, cfg.dollars - r.costUsd).toFixed(2)} left`);
  if (cfg.tokens != null) dims.push(`${lib.fmtTokens(Math.max(0, cfg.tokens - r.tokens))} tok left`);
  if (cfg.plan_pct != null) {
    const left = lib.planLeft(cfg, r.planNow, r.baselinePlan);
    if (left != null) dims.push(`${Math.max(0, left).toFixed(1)}% plan left` + (cfg.plan_rel ? "" : ` (window at ${r.planNow.toFixed(1)}%, cap ${cfg.plan_pct}%)`));
  }
  const t = tier(overall), sig = lib.tokensLeft(cfg, st, now);
  const tag = sig != null ? `<total_tokens>${sig} tokens left</total_tokens>\n` : "";
  return { overall, pct, text: `${tag}<redline> ${pct}% used · tier ${t.tag} · ${dims.join(" · ")}\n  ${t.line}\n</redline>` };
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  let d = {}; try { d = JSON.parse(input || "{}"); } catch {}
  const event = d.hook_event_name || "";
  const sessionId = d.session_id || "unknown";
  const cfg = lib.readJSON(lib.cfgPath(sessionId));
  if (!cfg) return;
  const now = Math.floor(Date.now() / 1000);
  const st = lib.readJSON(lib.statePath(sessionId)) || {};

  // Close an active turn's past-deadline overshoot when the turn ends.
  if (event === "Stop" || event === "SubagentStop") {
    if (st.turn_start) lib.writeJSON(lib.statePath(sessionId), closeTurn(cfg, st, now));
    return;
  }
  if (event === "SessionEnd") {
    const st2 = closeTurn(cfg, st, now);
    lib.retire(cfg, st2, now, "session_end");
    try { require("fs").rmSync(lib.cfgPath(sessionId)); } catch {}
    try { require("fs").rmSync(lib.statePath(sessionId)); } catch {}
    return;
  }

  const L = ledger(cfg, st, now);

  if (event === "PreToolUse") {
    if (L.overall >= CEIL) { process.stdout.write(JSON.stringify({ continue: false, stopReason: `redline: budget spent (${L.pct}%). Run /redline to continue.` })); return; }
    if (L.overall >= LOCK) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
        permissionDecisionReason: `redline: ${L.pct}% - reserve reached, tools locked to land within budget.`,
        additionalContext: `${L.text}\nTool blocked. Write your final answer from what you already have, then stop.` } }));
      return;
    }
    return;
  }

  if (event === "UserPromptSubmit") {
    if (L.overall >= CEIL) { process.stdout.write(JSON.stringify({ decision: "block", reason: `🔴 redline: budget spent (${L.pct}%). Run /redline 10m $5 (or /redline off) to continue.` })); return; }
    lib.writeJSON(lib.statePath(sessionId), { ...st, turn_start: now }); // a turn begins
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: L.text } }));
    return;
  }

  if (event === "SubagentStart") {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: `${L.text}\nYou share this session's budget umbrella - pace accordingly.` } }));
    return;
  }

  if (event === "PostToolUse") {
    const ns = { ...st, peak: Math.max(st.peak || 0, L.overall) };
    let extra = "";
    const crossedLow = L.overall >= LOW ? 70 : 0;
    if (crossedLow && crossedLow > (st.last_threshold || 0)) { ns.last_threshold = crossedLow; extra = "\n⛳ Entering the landing zone - converge on delivering the result; tools lock at 90%."; }
    lib.writeJSON(lib.statePath(sessionId), ns);
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: L.text + extra } }));
    return;
  }
});
