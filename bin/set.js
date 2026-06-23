#!/usr/bin/env node
"use strict";
// Called by the /redline slash command. Parses a budget spec and writes the
// session config. Its stdout is injected into Claude's context, so the text
// here doubles as the instruction that primes the agent to pace itself.
//
// Usage: node set.js "<args>" "<session_id>"
//   /redline 10m            -> 10 minute time budget
//   /redline 30m $5         -> 30 min AND $5
//   /redline 1h 200k        -> 1 hour AND 200k tokens
//   /redline 45m 10%        -> 45 min AND 10% of the 5-hour plan window
//   /redline 10% 7d         -> 10% of the 7-day plan window
//   /redline off            -> clear

const fs = require("fs");
const lib = require("./lib.js");

const argStr = (process.argv[2] || "").trim();
let sessionId = (process.argv[3] || "").trim();
// If the slash command's ${CLAUDE_SESSION_ID} didn't expand, fall back to a
// pending file that the statusline claims on its next render.
const pending = !sessionId || sessionId.includes("CLAUDE_SESSION_ID");

const tokens = argStr.split(/\s+/).filter(Boolean);

function clear() {
  if (!pending) {
    try { fs.rmSync(lib.cfgPath(sessionId)); } catch {}
    try { fs.rmSync(lib.statePath(sessionId)); } catch {}
  }
  try { fs.rmSync(lib.pendingPath()); } catch {}
  console.log("redline cleared — no budget is active for this session.");
}

if (!argStr || ["off", "clear", "none", "stop", "reset", "cancel"].includes(tokens[0])) {
  clear();
  process.exit(0);
}

const cfg = { set_at: Math.floor(Date.now() / 1000) };
let wantSevenDay = false;
const unknown = [];

for (const t of tokens) {
  if (/^7d(ay)?$/i.test(t)) { wantSevenDay = true; continue; }
  if (/^\$/.test(t)) {
    const v = parseFloat(t.slice(1));
    if (v > 0) cfg.dollars = v; else unknown.push(t);
  } else if (/%$/.test(t) || /%(7d|7day)$/i.test(t)) {
    const m = t.match(/^(\d+(?:\.\d+)?)%/);
    if (m) { cfg.plan_pct = parseFloat(m[1]); if (/7d/i.test(t)) wantSevenDay = true; }
    else unknown.push(t);
  } else if (/^\d+(?:\.\d+)?k$/i.test(t)) {
    cfg.tokens = Math.round(parseFloat(t) * 1e3);
  } else if (/^\d+(?:\.\d+)?M$/.test(t)) { // capital M = million tokens
    cfg.tokens = Math.round(parseFloat(t) * 1e6);
  } else if (/^(\d+\s*[hmsd])+$/i.test(t.replace(/\s+/g, ""))) {
    let sec = 0;
    for (const m of t.matchAll(/(\d+)\s*([hmsd])/gi)) {
      const n = parseInt(m[1], 10);
      const u = m[2].toLowerCase();
      sec += n * (u === "h" ? 3600 : u === "m" ? 60 : u === "d" ? 86400 : 1);
    }
    cfg.duration_sec = (cfg.duration_sec || 0) + sec;
  } else if (/^\d+$/.test(t) && parseInt(t, 10) >= 1000) {
    cfg.tokens = parseInt(t, 10); // bare large integer = token count
  } else {
    unknown.push(t);
  }
}

if (cfg.plan_pct != null) cfg.plan_window = wantSevenDay ? "seven_day" : "five_hour";

if (!cfg.duration_sec && !cfg.dollars && !cfg.tokens && cfg.plan_pct == null) {
  console.log(
    "redline: couldn't read a budget from " + JSON.stringify(argStr) + ".\n" +
    "Examples:  /redline 10m   |   /redline 30m $5   |   /redline 1h 200k   |   /redline 45m 10%   |   /redline off"
  );
  process.exit(0);
}

cfg.session_id = pending ? null : sessionId;
lib.writeJSON(pending ? lib.pendingPath() : lib.cfgPath(sessionId), cfg);
if (!pending) { try { fs.rmSync(lib.statePath(sessionId)); } catch {} } // reset baselines

// Human-readable summary of what was set.
const parts = [];
if (cfg.duration_sec) parts.push(lib.fmtDuration(cfg.duration_sec));
if (cfg.dollars) parts.push("$" + cfg.dollars.toFixed(2));
if (cfg.tokens) parts.push(lib.fmtTokens(cfg.tokens) + " tokens");
if (cfg.plan_pct != null) parts.push(cfg.plan_pct + "% of " + (wantSevenDay ? "7-day" : "5-hour") + " plan");

console.log(
`✅ redline budget set for this session: ${parts.join(" + ")}.

The statusline shows live burn-down. Treat this as a soft budget you must land within:
1. First, briefly state how you'll fit the task in this budget, and what you'll cut first if it gets tight.
2. Prioritise the core deliverable; defer polish and exploration.
3. As the budget depletes you'll get reminders — converge, keep tool outputs small, and keep responses terse.
4. Aim to deliver a working result before the budget runs out, not to stop abruptly when it does.`
);
