#!/usr/bin/env node
"use strict";
// One-shot installer. Safely merges redline into ~/.claude/settings.json and
// installs the /redline slash command. Idempotent — re-running is safe.

const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const CLAUDE = path.join(os.homedir(), ".claude");
const SETTINGS = path.join(CLAUDE, "settings.json");
const CMD_DIR = path.join(CLAUDE, "commands");
const statuslineCmd = `node "${path.join(REPO, "bin", "statusline.js")}"`;
const hookCmd = `node "${path.join(REPO, "bin", "hook.js")}"`;
const setJs = path.join(REPO, "bin", "set.js");

fs.mkdirSync(CLAUDE, { recursive: true });
fs.mkdirSync(CMD_DIR, { recursive: true });

let settings = {};
if (fs.existsSync(SETTINGS)) {
  fs.copyFileSync(SETTINGS, SETTINGS + ".bak");
  try { settings = JSON.parse(fs.readFileSync(SETTINGS, "utf8")); } catch {
    console.error("⚠️  ~/.claude/settings.json isn't valid JSON. Backed up to settings.json.bak; fix it and re-run."); process.exit(1);
  }
}

// Statusline: only set if absent, never clobber an existing one.
let slNote;
if (!settings.statusLine) {
  settings.statusLine = { type: "command", command: statuslineCmd, refreshInterval: 1000 };
  slNote = "installed redline statusline.";
} else if ((settings.statusLine.command || "").includes("redline")) {
  settings.statusLine.command = statuslineCmd; // refresh path
  slNote = "redline statusline already present (path refreshed).";
} else {
  slNote = "kept your existing statusline. To use redline's, set statusLine.command to:\n    " + statuslineCmd;
}

// Hooks: additive + de-duped by command.
settings.hooks = settings.hooks || {};
for (const ev of ["PreToolUse", "UserPromptSubmit", "PostToolUse"]) {
  settings.hooks[ev] = settings.hooks[ev] || [];
  const already = JSON.stringify(settings.hooks[ev]).includes("redline");
  if (!already) settings.hooks[ev].push({ hooks: [{ type: "command", command: hookCmd }] });
}

fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2));

// Slash command (path to set.js baked in).
const cmdMd = `---
description: "Set/clear this session's time + token/$ budget. e.g. /redline 10m $5 | 30m 200k | 45m 10% | off"
---
!\`node "${setJs}" "$ARGUMENTS" "\${CLAUDE_SESSION_ID}"\`
`;
fs.writeFileSync(path.join(CMD_DIR, "redline.md"), cmdMd);

console.log(`✅ redline installed.
   - ${slNote}
   - hooks: UserPromptSubmit + PostToolUse wired.
   - command: /redline

Restart Claude Code, then try:  /redline 10m $5
Clear anytime with:            /redline off`);
