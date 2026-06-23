#!/usr/bin/env node
"use strict";
// redline statusline: the live monitor AND the sensor.
// - Reads Claude Code's statusline JSON on stdin (has cost + rate_limits).
// - Renders ONE burn-down bar for the binding constraint (the dimension closest
//   to its limit — the one that will stop you first), tagged with which gauge it
//   is, plus a compact figure per configured dimension.
// - Writes a state snapshot the hook reads (the hook's stdin lacks cost/rate_limits).

const lib = require("./lib.js");

const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", cyan: "\x1b[36m",
};
const color = (frac) => (frac >= 0.9 ? C.bold + C.red : frac >= 0.75 ? C.red : frac >= 0.5 ? C.yellow : C.green);
const EMOJI = { time: "⏱", cost: "💰", tokens: "🔤", plan: "📊" };

function bar(frac, width = 12) {
  const filled = Math.max(0, Math.min(width, Math.round(frac * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function read(stdin) {
  let d = {};
  try { d = JSON.parse(stdin || "{}"); } catch {}
  return d;
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  const d = read(input);
  const sessionId = d.session_id || "unknown";
  const model = (d.model && d.model.display_name) || "";

  let cfg = lib.readJSON(lib.cfgPath(sessionId));
  if (!cfg) {
    const pend = lib.readJSON(lib.pendingPath());
    if (pend) {
      cfg = { ...pend, session_id: sessionId };
      lib.writeJSON(lib.cfgPath(sessionId), cfg);
      try { require("fs").rmSync(lib.pendingPath()); } catch {}
    }
  }

  if (!cfg) {
    process.stdout.write(`${C.dim}redline ░░░░░░░░░░░░ no budget · /redline 10m $5${C.reset}` + (model ? `  ${C.dim}${model}${C.reset}` : ""));
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const costUsd = (d.cost && d.cost.total_cost_usd) || 0;
  const tokensUsed = cfg.tokens ? lib.sumTranscriptTokens(d.transcript_path) : 0;

  let baselinePlan = null, planNow = null;
  if (cfg.plan_pct != null) {
    const rl = d.rate_limits && d.rate_limits[cfg.plan_window || "five_hour"];
    planNow = rl ? rl.used_percentage : null;
    const prev = lib.readJSON(lib.statePath(sessionId)) || {};
    baselinePlan = prev.baseline_plan != null ? prev.baseline_plan : planNow;
  }

  const { f, overall } = lib.fractions(cfg, now, { costUsd, tokens: tokensUsed, planNow, baselinePlan });

  const prevState = lib.readJSON(lib.statePath(sessionId)) || {};
  lib.writeJSON(lib.statePath(sessionId), {
    ts: now, cost_usd: costUsd, tokens: tokensUsed,
    plan_now: planNow, baseline_plan: baselinePlan,
    f, overall, last_threshold: prevState.last_threshold || 0,
    peak: Math.max(prevState.peak || 0, overall),
  });

  const segs = [];
  if (cfg.duration_sec != null) {
    const left = cfg.duration_sec - (now - cfg.set_at);
    segs.push(`${color(f.time)}⏱ ${lib.fmtDuration(Math.max(0, left))}${C.reset}`);
  }
  if (cfg.dollars != null) {
    segs.push(`${color(f.cost)}💰 $${costUsd.toFixed(2)}/$${cfg.dollars.toFixed(2)}${C.reset}`);
  }
  if (cfg.tokens != null) {
    segs.push(`${color(f.tokens)}🔤 ${lib.fmtTokens(tokensUsed)}/${lib.fmtTokens(cfg.tokens)}${C.reset}`);
  }
  if (cfg.plan_pct != null && planNow != null) {
    const used = Math.max(0, planNow - baselinePlan);
    segs.push(`${color(f.plan)}📊 ${used.toFixed(1)}/${cfg.plan_pct}%${C.reset}`);
  }

  // Tag the bar with the binding gauge when more than one dimension is set,
  // so a red bar while one figure still looks cheap isn't a mystery.
  let driver = null, max = -1;
  for (const k of Object.keys(f)) if (f[k] > max) { max = f[k]; driver = k; }
  const tag = Object.keys(f).length > 1 && driver ? EMOJI[driver] + " " : "";

  const pct = Math.round(overall * 100);
  const col = color(overall);
  const head = `${col}${C.bold}redline${C.reset} ${col}${tag}${bar(overall)} ${pct}%${C.reset}`;
  process.stdout.write([head, ...segs].join(`${C.dim} · ${C.reset}`));
});
