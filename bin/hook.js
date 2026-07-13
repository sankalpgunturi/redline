#!/usr/bin/env node
"use strict";
// redline pacer + enforcer (CLI v2.1).
// Cooperative: native <total_tokens> signal + <redline> ledger (tiers) every turn.
// Coercive: PreToolUse deny@90 -> continue:false@100 ; UserPromptSubmit block@100.
// Time model: wall-clock to the deadline; PAST it, only ACTIVE response time adds
// (Stop closes each turn's past-deadline overshoot), so idle never inflates "over".

const lib = require("./lib.js");
const LOW = 0.70, LOCK = 0.90, CEIL = 1.0;

const MANIFEST = ' End your final message with one line: "LANDING: delivered <what>; cut <what>" (or "cut nothing").';
function tier(o) {
  if (o >= CEIL) return { tag: "OVER", line: "Budget spent - stop. Do not start new work; do not run tools." + MANIFEST };
  if (o >= LOCK) return { tag: "RESERVE", line: "Reserve zone: tool calls are LOCKED. Write your final answer/result from what you already have, then stop." + MANIFEST };
  if (o >= LOW)  return { tag: "LOW", line: "Ship the minimal result NOW: stop exploring, drop nice-to-haves, keep tool outputs small (grep narrowly, head/tail, don't re-read whole files), deliver + summarise. If you cannot finish in the remaining budget, say so and cut scope." + MANIFEST };
  if (o >= 0.30) return { tag: "MEDIUM", line: "Targeted work only - spend budget on steps that change your next action; limit exploration." };
  return { tag: "HIGH", line: "Explore as needed, but keep the budget in view." };
}

// Landing-zone ping for fleet operators running many sessions (opt-in: redline notify on).
function notify(st, sessionId, level, pct) {
  if (process.platform !== "darwin") return;
  try {
    if (!require("fs").existsSync(lib.notifyPath())) return;
    const label = st.name || (st.cwd ? require("path").basename(st.cwd) : sessionId.slice(0, 6));
    const msg = level >= 90 ? `RESERVE at ${pct}% - tools locked, landing now` : `landing zone at ${pct}% - wrapping up`;
    require("child_process").spawn("osascript", ["-e", `display notification ${JSON.stringify(label + ": " + msg)} with title "redline"`], { stdio: "ignore", detached: true }).unref();
  } catch {}
}

function closeTurn(cfg, st, now) {
  if (!st.turn_start) return st;
  const deadline = cfg.set_at + (cfg.duration_sec || 0);
  const add = cfg.duration_sec && now > deadline ? Math.max(0, now - Math.max(st.turn_start, deadline)) : 0;
  return { ...st, turn_start: null, overshoot_sec: (st.overshoot_sec || 0) + add };
}

function ledger(cfg, g, snap, st, now) {
  const r = { costUsd: st.cost_usd || 0, tokens: st.tokens || 0, planNow: st.plan_now, baselinePlan: st.baseline_plan, turnStart: st.turn_start, overshootSec: st.overshoot_sec };
  const sess = cfg ? lib.fractions(cfg, now, r).overall : 0;
  const gf = lib.fleetFraction(g, snap, now);
  const overall = Math.max(sess, gf || 0); // binding constraint: this session OR the fleet
  const pct = Math.round(overall * 100);
  const rate = cfg ? lib.burnRate(st, cfg, now) : null;
  const dims = [];
  if (cfg && cfg.duration_sec != null) {
    const used = lib.timeUsedSec(cfg, now, st.turn_start, st.overshoot_sec);
    dims.push(`⏱ ${lib.fmtDuration(Math.max(0, cfg.duration_sec - used))} left` + (rate ? ` (~${lib.fmtTokens(rate)} tok/s)` : ""));
  }
  if (cfg && cfg.dollars != null) dims.push(`$${Math.max(0, cfg.dollars - r.costUsd).toFixed(2)} left`);
  if (cfg && cfg.tokens != null) dims.push(`${lib.fmtTokens(Math.max(0, cfg.tokens - r.tokens))} tok left`);
  if (cfg && cfg.plan_pct != null) {
    const left = lib.planLeft(cfg, r.planNow, r.baselinePlan);
    if (left != null) dims.push(`${Math.max(0, left).toFixed(1)}% plan left` + (cfg.plan_rel ? "" : ` (window at ${r.planNow.toFixed(1)}%, cap ${cfg.plan_pct}%)`));
  }
  if (gf != null) dims.push(`🌐 fleet: window ${(gf * g.plan_pct).toFixed(1)}% of ${g.plan_pct}% cap (shared by all sessions)`);
  const t = tier(overall);
  let sig = cfg ? lib.tokensLeft(cfg, st, now) : null;
  if (gf != null && snap) {
    // Fleet runway in tokens. tok_per_pct is non-cache, so this understates - which
    // only makes the landing earlier and softer.
    const p = snap[g.plan_window || "five_hour"];
    if (p && p.tok_per_pct) {
      const fleetTok = Math.max(0, Math.round((g.plan_pct - p.pct) * p.tok_per_pct));
      sig = sig == null ? fleetTok : Math.min(sig, fleetTok);
    }
  }
  const tag = sig != null ? `<total_tokens>${sig} tokens left</total_tokens>\n` : "";
  return { overall, sess, pct, gf, text: `${tag}<redline> ${pct}% used · tier ${t.tag} · ${dims.join(" · ")}\n  ${t.line}\n</redline>` };
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  let d = {}; try { d = JSON.parse(input || "{}"); } catch {}
  const event = d.hook_event_name || "";
  const sessionId = d.session_id || "unknown";
  const now = Math.floor(Date.now() / 1000);
  const cfg = lib.readJSON(lib.cfgPath(sessionId));
  const g = lib.readJSON(lib.globalPath());
  const snap = g ? lib.readJSON(lib.planPath()) : null;
  // The fleet budget applies to EVERY session, budgeted or not.
  if (!cfg && lib.fleetFraction(g, snap, now) == null) return;
  let st = lib.readJSON(lib.statePath(sessionId)) || {};
  // Headless fallback (claude -p, CI, background jobs): no statusline runs there, so
  // nothing writes the state snapshot. When it's missing/stale, sum the transcripts
  // right here so token budgets (and burn-rate translation) still enforce. Tokens only -
  // $ and plan % genuinely need the interactive sensor feed.
  if ((!st.ts || now - st.ts > 120) && d.transcript_path) {
    st = { ...st, tokens: Math.max(st.tokens || 0, lib.sumTranscriptTokens(d.transcript_path).total) };
  }

  // Turn end: close past-deadline overshoot and harvest the landing manifest.
  if (event === "Stop" || event === "SubagentStop") {
    if (!cfg) return;
    let ns = closeTurn(cfg, st, now);
    if (event === "Stop" && d.transcript_path) {
      const m = lib.lastLanding(d.transcript_path);
      if (m) ns = { ...ns, landing: m };
    }
    if (st.turn_start || ns.landing !== st.landing) lib.writeJSON(lib.statePath(sessionId), ns);
    return;
  }
  if (event === "SessionEnd") {
    if (!cfg) return; // the fleet budget outlives sessions; nothing to retire
    const st2 = closeTurn(cfg, st, now);
    lib.retire(cfg, st2, now, "session_end");
    try { require("fs").rmSync(lib.cfgPath(sessionId)); } catch {}
    try { require("fs").rmSync(lib.statePath(sessionId)); } catch {}
    return;
  }

  const L = ledger(cfg, g, snap, st, now);
  const fleetBound = L.gf != null && L.gf >= L.sess;
  const fixIt = fleetBound ? "Raise or clear it with: redline global" : "Run /redline to continue.";

  if (event === "PreToolUse") {
    if (L.overall >= CEIL) { process.stdout.write(JSON.stringify({ continue: false, stopReason: `redline: budget spent (${L.pct}%${fleetBound ? ", fleet cap" : ""}). ${fixIt}` })); return; }
    if (L.overall >= LOCK) {
      const ns = { ...st, denials: (st.denials || 0) + 1 }; // forced landing: the lock had to fire
      if ((st.last_threshold || 0) < 90) { ns.last_threshold = 90; notify(st, sessionId, 90, L.pct); }
      lib.writeJSON(lib.statePath(sessionId), ns);
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
        permissionDecisionReason: `redline: ${L.pct}% - reserve reached, tools locked to land within budget.`,
        additionalContext: `${L.text}\nTool blocked. Write your final answer from what you already have, then stop.` } }));
      return;
    }
    return;
  }

  if (event === "UserPromptSubmit") {
    if (L.overall >= CEIL) { process.stdout.write(JSON.stringify({ decision: "block", reason: `🔴 redline: budget spent (${L.pct}%${fleetBound ? " - fleet cap reached" : ""}). ${fleetBound ? "Adjust with: redline global" : "Run /redline 10m $5 (or /redline off) to continue."}` })); return; }
    if (cfg) lib.writeJSON(lib.statePath(sessionId), { ...st, turn_start: now }); // a turn begins
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: L.text } }));
    return;
  }

  if (event === "SubagentStart") {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: `${L.text}\nYou share this session's budget umbrella - pace accordingly.` } }));
    return;
  }

  if (event === "PostToolUse") {
    const ns = { ...st, peak: Math.max(st.peak || 0, L.sess) }; // session-only: fleet pressure isn't this session's overshoot
    let extra = "";
    const level = L.overall >= LOCK ? 90 : L.overall >= LOW ? 70 : 0;
    if (level && level > (st.last_threshold || 0)) {
      ns.last_threshold = level;
      if (level === 70) extra = "\n⛳ Entering the landing zone - converge on delivering the result; tools lock at 90%.";
      notify(st, sessionId, level, L.pct);
    }
    if (cfg) lib.writeJSON(lib.statePath(sessionId), ns);
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: L.text + extra } }));
    return;
  }
});
