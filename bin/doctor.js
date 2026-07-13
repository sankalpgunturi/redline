#!/usr/bin/env node
"use strict";
// redline doctor: is redline actually wired and sensing? The classic silent failure
// is a kept third-party statusline - hooks fire but $/plan budgets have no sensor.
const fs = require("fs");
const os = require("os");
const path = require("path");
const lib = require("./lib.js");

const SETTINGS = path.join(os.homedir(), ".claude", "settings.json");
const CMD = path.join(os.homedir(), ".claude", "commands", "redline.md");
let issues = 0;
const ok = (m) => console.log("  ✅ " + m);
const warn = (m) => { issues++; console.log("  ⚠️  " + m); };

console.log("\n  redline doctor\n");

const major = parseInt(process.versions.node, 10);
major >= 18 ? ok("node " + process.versions.node) : warn("node >= 18 required (found " + process.versions.node + ")");

const s = lib.readJSON(SETTINGS);
if (!s) {
  warn("~/.claude/settings.json missing or invalid - run: redline install");
} else {
  const slCmd = (s.statusLine && s.statusLine.command) || "";
  slCmd.includes("redline")
    ? ok("statusline wired (the $/token/plan sensor)")
    : warn("statusline is not redline's - $ and plan budgets have NO live sensor (time and headless token budgets still enforce). Point statusLine.command at `redline statusline` or re-run: redline install");
  const events = ["PreToolUse", "UserPromptSubmit", "PostToolUse", "SubagentStart", "SessionEnd", "Stop"];
  const missing = events.filter((e) => !JSON.stringify((s.hooks || {})[e] || []).includes("redline"));
  missing.length ? warn("hooks not wired: " + missing.join(", ") + " - re-run: redline install") : ok("all " + events.length + " hooks wired");
}

fs.existsSync(CMD) ? ok("/redline command installed") : warn("/redline command missing - re-run: redline install");

const now = Math.floor(Date.now() / 1000);
const snap = lib.readJSON(lib.planPath());
if (snap && snap.ts && snap.five_hour) {
  const p = snap.five_hour;
  ok(`plan sensor: reading ${lib.fmtDuration(now - snap.ts)} ago - 5h window at ${p.pct.toFixed(1)}%` +
    (p.resets_at ? `, resets in ${lib.fmtDuration(p.resets_at - now)}` : "") +
    (p.tok_per_pct ? `, 1% ≈ ${lib.fmtTokens(p.tok_per_pct)} tok` : ""));
} else {
  warn("no plan-window reading yet - plan % budgets need Pro/Max auth and one interactive statusline render");
}

let h = 0;
try { h = fs.readFileSync(lib.historyPath(), "utf8").split("\n").filter(Boolean).length; } catch {}
console.log("\n  " + (issues ? issues + " issue(s) found" : "all clear") + " · " + h + " finished session(s) in history\n");
process.exit(issues ? 1 : 0);
