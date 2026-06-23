#!/usr/bin/env node
"use strict";
// Wire redline into ~/.claude/settings.json (statusline + hooks) and install the
// /redline command. Idempotent. Wires through the `redline` dispatcher so the
// commands stay valid across upgrades (Homebrew repoints its stable symlink).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const CLAUDE = path.join(os.homedir(), ".claude");
const SETTINGS = path.join(CLAUDE, "settings.json");
const CMD_DIR = path.join(CLAUDE, "commands");

// Prefer a `redline` on PATH if it's ours (stable across upgrades, e.g. Homebrew's
// /opt/.../bin/redline symlink); otherwise use this repo's absolute dispatcher.
function resolveDispatcher() {
  const local = path.join(REPO, "bin", "redline");
  try {
    const w = execSync("command -v redline 2>/dev/null || true", { shell: "/bin/bash" }).toString().trim();
    if (w && /^redline /.test(execSync(`"${w}" version 2>/dev/null || true`, { shell: "/bin/bash" }).toString())) return w;
  } catch {}
  return local;
}
const RL = resolveDispatcher();
const statuslineCmd = `"${RL}" statusline`;
const hookCmd = `"${RL}" hook`;

fs.mkdirSync(CLAUDE, { recursive: true });
fs.mkdirSync(CMD_DIR, { recursive: true });

let settings = {};
if (fs.existsSync(SETTINGS)) {
  fs.copyFileSync(SETTINGS, SETTINGS + ".bak");
  try { settings = JSON.parse(fs.readFileSync(SETTINGS, "utf8")); } catch {
    console.error("⚠️  ~/.claude/settings.json isn't valid JSON. Backed up to settings.json.bak; fix it and re-run."); process.exit(1);
  }
}

let slNote;
if (!settings.statusLine) {
  settings.statusLine = { type: "command", command: statuslineCmd, refreshInterval: 1 };
  slNote = "installed redline statusline.";
} else if ((settings.statusLine.command || "").includes("redline")) {
  settings.statusLine.command = statuslineCmd;
  slNote = "redline statusline already present (path refreshed).";
} else {
  slNote = "kept your existing statusline. To use redline's, set statusLine.command to:\n    " + statuslineCmd;
}

settings.hooks = settings.hooks || {};
for (const ev of ["PreToolUse", "UserPromptSubmit", "PostToolUse", "SubagentStart", "SessionEnd", "Stop"]) {
  settings.hooks[ev] = (settings.hooks[ev] || []).filter((e) => !JSON.stringify(e).includes("redline")); // drop stale redline entries
  settings.hooks[ev].push({ hooks: [{ type: "command", command: hookCmd }] });
}
fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2));

const cmdMd = `---
description: "Set/clear this session's time + token/$ budget. e.g. /redline 10m $5 | 30m 200k | 45m 10% | off"
---
!\`"${RL}" set '$ARGUMENTS' "\${CLAUDE_SESSION_ID}"\`
`;
fs.writeFileSync(path.join(CMD_DIR, "redline.md"), cmdMd);

console.log(`✅ redline installed.
   - ${slNote}
   - hooks wired: PreToolUse, UserPromptSubmit, PostToolUse, SubagentStart, SessionEnd, Stop
   - command: /redline   (set a budget: /redline 10m $5)
   - wired via: ${RL}

Restart Claude Code, then try:  /redline 10m $5
Stats anytime:                  redline stats`);
