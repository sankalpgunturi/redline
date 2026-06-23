#!/usr/bin/env node
"use strict";
// Remove redline from Claude Code: its statusLine, hooks, and /redline command.
// Budgets/history under ~/.claude/redline are preserved (delete that dir to purge).
const fs = require("fs"), os = require("os"), path = require("path");
const SETTINGS = path.join(os.homedir(), ".claude", "settings.json");
const CMD = path.join(os.homedir(), ".claude", "commands", "redline.md");
const has = (x) => JSON.stringify(x ?? "").includes("redline");

let s = {};
try { s = JSON.parse(fs.readFileSync(SETTINGS, "utf8")); } catch { console.log("redline: nothing to remove (no settings.json)."); process.exit(0); }
fs.copyFileSync(SETTINGS, SETTINGS + ".bak");

if (s.statusLine && has(s.statusLine.command)) delete s.statusLine;
if (s.hooks) for (const ev of Object.keys(s.hooks)) {
  s.hooks[ev] = (s.hooks[ev] || []).filter((e) => !has(e));
  if (!s.hooks[ev].length) delete s.hooks[ev];
}
fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2));
try { fs.rmSync(CMD); } catch {}
console.log("✅ redline removed from Claude Code (settings backed up to settings.json.bak).\n   Budgets + analytics kept in ~/.claude/redline - delete that dir to fully purge.");
