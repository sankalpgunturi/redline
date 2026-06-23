#!/usr/bin/env node
"use strict";
// redline watch - a high-frequency live budget ticker for a split terminal pane.
// The Claude Code statusline caps at 1s refresh; this redraws ~10x/second with a
// smooth sub-character bar and tenths-of-a-second countdown, so you SEE it move.
//
//   node ~/redline/bin/watch.js [session-id]
//
// With no arg it follows the most-recently-set budget. Time ticks smoothly
// (computed locally each frame); $/token/plan update as the statusline snapshot does.

const fs = require("fs");
const path = require("path");
const lib = require("./lib.js");

const FPS_MS = 100;
const BARW = 34;
const C = { reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", gray: "\x1b[90m" };
const col = (f) => (f >= 0.9 ? C.bold + C.red : f >= 0.75 ? C.red : f >= 0.5 ? C.yellow : C.green);
const BLOCKS = [" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉"]; // 8 sub-cell levels

const argId = process.argv[2];

function pickConfig() {
  if (argId) return lib.cfgPath(argId);
  let best = null, bestT = -1;
  try {
    for (const f of fs.readdirSync(lib.DIR)) {
      if (!f.endsWith(".json") || f.endsWith(".state.json") || f === "pending.json") continue;
      const p = path.join(lib.DIR, f);
      const t = fs.statSync(p).mtimeMs;
      if (t > bestT) { bestT = t; best = p; }
    }
  } catch {}
  return best;
}

function smoothBar(frac) {
  const f = Math.max(0, Math.min(1, frac));
  const exact = f * BARW;
  const full = Math.floor(exact);
  const rem = Math.floor((exact - full) * 8);
  let bar = "█".repeat(full);
  if (full < BARW) bar += BLOCKS[rem];
  bar += C.gray + "·".repeat(Math.max(0, BARW - full - 1)) + C.reset;
  return bar;
}

function fmtTenths(sec) {
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const t = Math.floor((sec * 10) % 10);
  const h = Math.floor(m / 60);
  if (h) return `${h}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}.${t}`;
  return `${m}:${String(s).padStart(2, "0")}.${t}`;
}

process.stdout.write("\x1b[?25l"); // hide cursor
function cleanup() { process.stdout.write("\x1b[?25h\x1b[0m\n"); process.exit(0); }
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

let lastLines = 0;
function draw(lines) {
  let out = "\x1b[H\x1b[2J"; // home + clear
  out += lines.join("\n") + "\n";
  process.stdout.write(out);
  lastLines = lines.length;
}

function tick() {
  const cfgPath = pickConfig();
  const cfg = cfgPath && lib.readJSON(cfgPath);
  if (!cfg) {
    draw([ "", `  ${C.bold}redline${C.reset}  ${C.dim}waiting for a budget…${C.reset}`,
      "", `  ${C.dim}run ${C.reset}/redline 10m $5${C.dim} in Claude Code${C.reset}`, "" ]);
    return;
  }
  const id = cfg.session_id || path.basename(cfgPath, ".json");
  const st = lib.readJSON(lib.statePath(id)) || {};
  const now = Date.now() / 1000;
  const { f, overall } = lib.fractions(cfg, now, {
    costUsd: st.cost_usd || 0, tokens: st.tokens || 0,
    planNow: st.plan_now, baselinePlan: st.baseline_plan,
    turnStart: st.turn_start, overshootSec: st.overshoot_sec,
  });
  const pct = Math.round(overall * 100);
  const c = col(overall);

  const rows = [];
  if (cfg.duration_sec != null) {
    const leftS = cfg.duration_sec - lib.timeUsedSec(cfg, now, st.turn_start, st.overshoot_sec);
    rows.push(`${col(f.time)}⏱  ${fmtTenths(leftS)} left${C.reset}  ${C.dim}/ ${lib.fmtDuration(cfg.duration_sec)}${C.reset}`);
  }
  if (cfg.dollars != null) rows.push(`${col(f.cost)}💰 $${Math.max(0, cfg.dollars - (st.cost_usd || 0)).toFixed(2)} left  ${C.dim}/ $${cfg.dollars.toFixed(2)}${C.reset}`);
  if (cfg.tokens != null) rows.push(`${col(f.tokens)}🔤 ${lib.fmtTokens(Math.max(0, cfg.tokens - (st.tokens || 0)))} left  ${C.dim}/ ${lib.fmtTokens(cfg.tokens)}${C.reset}`);
  if (cfg.plan_pct != null && st.plan_now != null && st.baseline_plan != null)
    rows.push(`${col(f.plan)}📊 ${Math.max(0, cfg.plan_pct - (st.plan_now - st.baseline_plan)).toFixed(1)}% plan left${C.reset}`);

  const zone = overall >= 0.9 ? `${C.red}LOCK${C.reset}` : overall >= 0.8 ? `${C.red}LANDING${C.reset}`
    : overall >= 0.5 ? `${C.yellow}CRUISE${C.reset}` : `${C.green}GREEN${C.reset}`;

  draw([
    "",
    `  ${c}${C.bold}R E D L I N E${C.reset}    ${zone}`,
    "",
    `  ${c}${smoothBar(overall)}${C.reset}  ${c}${C.bold}${pct}%${C.reset}`,
    "",
    ...rows.map((r) => "  " + r),
    "",
    `  ${C.dim}ctrl-c to exit · follows ${argId ? "session " + argId.slice(0, 8) : "the latest /redline"}${C.reset}`,
    "",
  ]);
}

tick();
setInterval(tick, FPS_MS);
