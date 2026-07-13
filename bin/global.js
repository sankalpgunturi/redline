#!/usr/bin/env node
"use strict";
// redline global: a machine-wide plan-window ceiling every session respects.
// The plan window is shared across all sessions, so this is the budget that
// protects the actual scarce resource. Plan % only - per-session budgets
// handle time/$/tokens.
//
//   redline global 60%      -> every session starts landing as the 5-hour window nears 60%
//   redline global 60% 7d   -> ceiling on the 7-day window
//   redline global off      -> clear
//   redline global          -> status
const fs = require("fs");
const lib = require("./lib.js");

const argStr = (process.argv[2] || "").trim();
const tokens = argStr.split(/\s+/).filter(Boolean);
const now = Math.floor(Date.now() / 1000);

function status() {
  const g = lib.readJSON(lib.globalPath());
  if (!g) { console.log("redline global: no fleet budget set.  Example: redline global 60%"); return; }
  const snap = lib.readJSON(lib.planPath());
  const f = lib.fleetFraction(g, snap, now);
  const win = g.plan_window === "seven_day" ? "7-day" : "5-hour";
  console.log(`redline global: fleet ceiling ${g.plan_pct}% of the ${win} window` +
    (f != null ? ` - window at ${(f * g.plan_pct).toFixed(1)}% now (${Math.round(f * 100)}% of the ceiling)` : " - no fresh window reading yet") +
    ".  Clear with: redline global off");
}

if (!argStr) { status(); process.exit(0); }
if (["off", "clear", "none", "stop", "reset", "cancel"].includes(tokens[0])) {
  try { fs.rmSync(lib.globalPath()); } catch {}
  console.log("redline global cleared - sessions pace only against their own budgets.");
  process.exit(0);
}

let pct = null, sevenDay = false;
for (const t of tokens) {
  const m = t.match(/^(\d+(?:\.\d+)?)%(7d|7day)?$/i);
  if (m) { pct = parseFloat(m[1]); if (m[2]) sevenDay = true; }
  else if (/^7d(ay)?$/i.test(t)) sevenDay = true;
  else { console.log(`redline global: only a plan ceiling makes sense fleet-wide (the window is the shared resource). Couldn't read ${JSON.stringify(t)}.\nExamples:  redline global 60%   |   redline global 60% 7d   |   redline global off`); process.exit(0); }
}
if (pct == null || pct <= 0) { console.log("redline global: give a ceiling like 60%."); process.exit(0); }

lib.writeJSON(lib.globalPath(), { plan_pct: pct, plan_window: sevenDay ? "seven_day" : "five_hour", set_at: now });
console.log(`🌐 redline fleet budget set: every session on this machine lands softly as the ${sevenDay ? "7-day" : "5-hour"} window approaches ${pct}% used.`);
status();
