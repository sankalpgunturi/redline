#!/usr/bin/env node
"use strict";
// redline statusline: the live monitor AND the sensor.
// - Reads Claude Code's statusline JSON on stdin (has cost + rate_limits).
// - Renders ONE burn-down bar for the binding constraint (the dimension closest
//   to its limit - the one that will stop you first), tagged with which gauge it
//   is, plus a compact figure per configured dimension.
// - Writes a state snapshot the hook reads (the hook's stdin lacks cost/rate_limits).

const lib = require("./lib.js");

const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", cyan: "\x1b[36m",
};
const color = (frac) => (frac >= 0.9 ? C.bold + C.red : frac >= 0.75 ? C.red : frac >= 0.5 ? C.yellow : C.green);
const EMOJI = { time: "⏱", cost: "💰", tokens: "🔤", plan: "📊" };

// One track, two readings: solid fill = this session's budget burn, dim ▒ = the plan
// window's absolute level (shared across all sessions). Plan ahead of the burn draws
// as a ▒ tail beyond the fill; plan at/behind the burn draws as a ▒ notch inside the
// fill - the plan marker never disappears, whichever side of the burn it sits on.
function bar(frac, planFrac, colStr, width = 12) {
  const a = Math.max(0, Math.min(width, Math.round(frac * width)));
  const b = planFrac != null ? Math.max(0, Math.min(width, Math.round(planFrac * width))) : -1;
  if (b >= 0) {
    if (b > a || planFrac > frac) {
      const tail = Math.max(1, b - a);
      return colStr + "█".repeat(a) + C.reset + C.dim + "▒".repeat(tail) + C.reset + colStr + "░".repeat(Math.max(0, width - a - tail)) + C.reset;
    }
    if (a > 0) {
      const m = Math.max(0, b - 1); // notch cell for the plan position
      return colStr + "█".repeat(m) + C.reset + C.dim + "▒" + C.reset + colStr + "█".repeat(Math.max(0, a - m - 1)) + "░".repeat(width - a) + C.reset;
    }
  }
  return colStr + "█".repeat(a) + "░".repeat(width - a) + C.reset;
}

function read(stdin) {
  let d = {};
  try { d = JSON.parse(stdin || "{}"); } catch {}
  return d;
}

// used_percentage can arrive as an epoch timestamp when the window has no data yet
// (anthropics/claude-code#52326) - only trust sane 0-100 readings.
function rlOf(d, window) {
  const rl = d.rate_limits && d.rate_limits[window];
  return rl && typeof rl.used_percentage === "number" && rl.used_percentage >= 0 && rl.used_percentage <= 100 ? rl : null;
}

// Persist the latest plan-window reading globally (any session), so /redline can echo
// the plan's current state at set time and pulse can show it. tokPerPct (observed
// tokens per 1% of the window) rides along when a plan budget is producing one.
function writePlanSnap(d, now, window, tokPerPct) {
  const prev = lib.readJSON(lib.planPath()) || {};
  let dirty = false;
  for (const w of ["five_hour", "seven_day"]) {
    const rl = rlOf(d, w);
    if (rl) { prev[w] = { ...prev[w], pct: rl.used_percentage, resets_at: rl.resets_at || null }; dirty = true; }
  }
  if (tokPerPct != null && prev[window]) { prev[window].tok_per_pct = Math.round(tokPerPct); dirty = true; }
  if (dirty) { prev.ts = now; lib.writeJSON(lib.planPath(), prev); }
  return prev;
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

  const now = Math.floor(Date.now() / 1000);

  if (!cfg) {
    const snap = writePlanSnap(d, now, "five_hour", null);
    const g = lib.readJSON(lib.globalPath());
    const gf = lib.fleetFraction(g, snap, now);
    if (gf != null) {
      // No session budget, but the fleet ceiling still paces this session.
      const p = snap[g.plan_window || "five_hour"];
      const col = color(gf);
      const reset = p.resets_at ? `${C.dim} ↺${lib.fmtDuration(p.resets_at - now)}${C.reset}` : "";
      process.stdout.write(`${col}${C.bold}redline${C.reset} ${col}🌐 ${C.reset}${bar(gf, null, col)} ${col}${Math.round(gf * 100)}%${C.reset}${C.dim} · ${C.reset}${col}📊 ${Math.max(0, g.plan_pct - p.pct).toFixed(1)}% fleet left${C.reset}${reset}`);
      return;
    }
    const p = snap.five_hour || snap.seven_day;
    const plan = p ? ` plan ${p.pct.toFixed(0)}%${p.resets_at ? " ↺" + lib.fmtDuration(p.resets_at - now) : ""}` : " no budget";
    process.stdout.write(`${C.dim}redline ${C.reset}${bar(0, p ? p.pct / 100 : null, C.dim)}${C.dim}${plan} · /redline 10m $5${C.reset}` + (model ? `  ${C.dim}${model}${C.reset}` : ""));
    return;
  }

  const prevState = lib.readJSON(lib.statePath(sessionId)) || {};
  const costUsd = (d.cost && d.cost.total_cost_usd) || 0;
  const sums = lib.sumTranscriptTokens(d.transcript_path); // always: needed for burn-rate translation
  const tokensUsed = sums.total;

  const window = cfg.plan_window || "five_hour";
  let baselinePlan = null, planNow = null, baselineTokens = null, baselineNc = null, resetsAt = null, tokPerPct = null;
  if (cfg.plan_pct != null) {
    const rl = rlOf(d, window);
    planNow = rl ? rl.used_percentage : null;
    resetsAt = rl ? rl.resets_at : null;
    baselinePlan = prevState.baseline_plan != null ? prevState.baseline_plan : planNow;
    // Window reset/slid below the baseline: re-anchor, or the +N% delta goes negative ("-4%").
    if (baselinePlan != null && planNow != null && planNow < baselinePlan) baselinePlan = planNow;
    baselineTokens = prevState.baseline_tokens != null ? prevState.baseline_tokens : (planNow != null ? tokensUsed : null);
    baselineNc = prevState.baseline_nc != null ? prevState.baseline_nc : (planNow != null ? sums.nc : null);
    // Answer the question Anthropic doesn't: what does 1% of the window cost in tokens?
    // Non-cache tokens only - the limiter barely weighs cache reads, and counting them
    // made 1% look like 11M tokens.
    if (planNow != null && baselinePlan != null && planNow - baselinePlan >= 0.5 && sums.nc > (baselineNc || 0)) {
      tokPerPct = (sums.nc - baselineNc) / (planNow - baselinePlan);
    }
  }
  const snap = writePlanSnap(d, now, window, tokPerPct);
  const g = lib.readJSON(lib.globalPath());
  const gf = lib.fleetFraction(g, snap, now);

  const { f, overall } = lib.fractions(cfg, now, { costUsd, tokens: tokensUsed, planNow, baselinePlan, turnStart: prevState.turn_start, overshootSec: prevState.overshoot_sec });
  const bound = Math.max(overall, gf || 0); // what the bar shows: session OR fleet, whichever lands first

  lib.writeJSON(lib.statePath(sessionId), {
    ts: now, cost_usd: costUsd, tokens: tokensUsed,
    plan_now: planNow, baseline_plan: baselinePlan, baseline_tokens: baselineTokens, baseline_nc: baselineNc,
    f, overall, last_threshold: prevState.last_threshold || 0,
    peak: Math.max(prevState.peak || 0, overall), // session-only: fleet overshoot isn't this session's fault
    turn_start: prevState.turn_start ?? null, overshoot_sec: prevState.overshoot_sec || 0,
    cwd: d.cwd || prevState.cwd || null, name: d.session_name || prevState.name || null,
  });

  const segs = [];
  if (cfg.duration_sec != null) {
    const left = cfg.duration_sec - lib.timeUsedSec(cfg, now, prevState.turn_start, prevState.overshoot_sec);
    segs.push(`${color(f.time)}⏱ ${lib.fmtDuration(Math.max(0, left))}${C.reset}`);
  }
  if (cfg.dollars != null) {
    segs.push(`${color(f.cost)}💰 $${Math.max(0, cfg.dollars - costUsd).toFixed(2)} left${C.reset}`);
  }
  if (cfg.tokens != null) {
    segs.push(`${color(f.tokens)}🔤 ${lib.fmtTokens(Math.max(0, cfg.tokens - tokensUsed))} left${C.reset}`);
  }
  if (cfg.plan_pct != null && planNow != null) {
    const left = lib.planLeft(cfg, planNow, baselinePlan);
    const reset = resetsAt ? `${C.dim} ↺${lib.fmtDuration(resetsAt - now)}${C.reset}` : "";
    segs.push(`${color(f.plan)}📊 ${Math.max(0, left).toFixed(1)}% left${C.reset}${reset}`);
  }

  if (gf != null) {
    const windowPct = gf * g.plan_pct;
    segs.push(`${color(gf)}🌐 ${Math.max(0, g.plan_pct - windowPct).toFixed(1)}% fleet${C.reset}`);
  }

  // Tag the bar with the binding gauge when more than one dimension is set,
  // so a red bar while one figure still looks cheap isn't a mystery.
  let driver = null, max = -1;
  for (const k of Object.keys(f)) if (f[k] > max) { max = f[k]; driver = k; }
  let tag = Object.keys(f).length > 1 && driver ? EMOJI[driver] + " " : "";
  if (gf != null && gf >= max) tag = "🌐 "; // the fleet ceiling is the binding constraint

  // Plan overlay for the bar: the budget's own window if one is set, else the 5-hour window.
  const rlAny = cfg.plan_pct != null ? rlOf(d, window) : rlOf(d, "five_hour");
  const overlayFrac = rlAny ? rlAny.used_percentage / 100 : null;

  const pct = Math.round(bound * 100);
  const col = color(bound);
  const head = `${col}${C.bold}redline${C.reset} ${col}${tag}${C.reset}${bar(bound, overlayFrac, col)} ${col}${pct}%${C.reset}`;
  process.stdout.write([head, ...segs].join(`${C.dim} · ${C.reset}`));
});
