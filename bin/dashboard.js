#!/usr/bin/env node
"use strict";
// redline dashboard ("mission control"): every active budget across all your
// sessions, live, plus the lifetime "did it land within budget?" number.
// Live in a terminal, one snapshot when piped. `--json` dumps raw history.
const fs = require("fs");
const path = require("path");
const lib = require("./lib.js");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const once = args.includes("--once") || !process.stdout.isTTY;

const C = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", gray: "\x1b[90m" };
const col = (f) => (f >= 0.9 ? C.bold + C.red : f >= 0.75 ? C.red : f >= 0.5 ? C.yellow : C.green);
const BL = [" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
function bar(frac, w = 20) {
  const x = Math.max(0, Math.min(1, frac)) * w, full = Math.floor(x);
  let s = "█".repeat(full);
  if (full < w) s += BL[Math.floor((x - full) * 8)];
  return s + C.gray + "·".repeat(Math.max(0, w - full - 1)) + C.reset;
}

function activeSessions(now) {
  let files = [];
  try { files = fs.readdirSync(lib.DIR); } catch {}
  const out = [];
  for (const f of files) {
    if (!f.endsWith(".json") || f.endsWith(".state.json") || f === "pending.json" || f === "history.jsonl") continue;
    const id = f.slice(0, -5);
    const cfg = lib.readJSON(lib.cfgPath(id)); if (!cfg) continue;
    const st = lib.readJSON(lib.statePath(id)) || {};
    if (now - (st.ts || cfg.set_at || 0) > 3600) continue; // stale/closed session
    const r = { costUsd: st.cost_usd || 0, tokens: st.tokens || 0, planNow: st.plan_now, baselinePlan: st.baseline_plan, turnStart: st.turn_start, overshootSec: st.overshoot_sec };
    const { overall } = lib.fractions(cfg, now, r);
    const dims = [];
    if (cfg.duration_sec) dims.push("⏱ " + lib.fmtDuration(Math.max(0, cfg.duration_sec - lib.timeUsedSec(cfg, now, st.turn_start, st.overshoot_sec))) + " left");
    if (cfg.dollars) dims.push("💰 $" + Math.max(0, cfg.dollars - r.costUsd).toFixed(2) + " left");
    if (cfg.tokens) dims.push("🔤 " + lib.fmtTokens(Math.max(0, cfg.tokens - r.tokens)) + " left");
    if (cfg.plan_pct != null && r.planNow != null && r.baselinePlan != null) dims.push("📊 " + Math.max(0, cfg.plan_pct - (r.planNow - r.baselinePlan)).toFixed(1) + "% left");
    const label = st.name || (st.cwd ? path.basename(st.cwd) : id.slice(0, 6));
    out.push({ label, overall, dims, fresh: st.ts ? now - st.ts < 300 : false });
  }
  return out.sort((a, b) => b.overall - a.overall);
}

function history() {
  try { return fs.readFileSync(lib.historyPath(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); }
  catch { return []; }
}

function render() {
  const now = Math.floor(Date.now() / 1000);
  const L = ["", "  " + C.bold + "redline · dashboard" + C.reset, ""];

  const sess = activeSessions(now);
  L.push("  " + C.dim + "ACTIVE BUDGETS" + C.reset);
  if (!sess.length) L.push("    " + C.dim + "none · set one in any session with /redline 10m $5" + C.reset);
  for (const s of sess) {
    const c = col(s.overall), pct = Math.round(s.overall * 100);
    const dot = s.fresh ? c + "●" + C.reset : C.gray + "○" + C.reset;
    L.push("    " + dot + " " + s.label.padEnd(14).slice(0, 14) + " " + c + bar(s.overall) + C.reset + " " + c + String(pct).padStart(3) + "%" + C.reset + "  " + C.dim + s.dims.join(" · ") + C.reset);
  }
  L.push("");

  const h = history();
  L.push("  " + C.dim + "TRACK RECORD" + C.reset);
  if (!h.length) L.push("    " + C.dim + "no finished sessions yet · this fills in as sessions end" + C.reset);
  else {
    const landed = h.filter((r) => r.landed).length, rate = Math.round((landed / h.length) * 100);
    const over = h.filter((r) => !r.landed);
    const avgOver = over.length ? Math.round(over.reduce((a, r) => a + r.overshoot_pct, 0) / over.length) : 0;
    const c = rate >= 90 ? C.green : rate >= 70 ? C.yellow : C.red;
    L.push("    " + c + C.bold + rate + "%" + C.reset + " of sessions finished inside their budget  " + C.dim + "(" + landed + " of " + h.length + ")" + C.reset);
    L.push("    " + c + bar(rate / 100) + C.reset);
    if (over.length) L.push("    " + C.dim + over.length + " went over, by " + avgOver + "% on average" + C.reset);
  }
  L.push("");
  if (!once) L.push("  " + C.dim + "refreshing · ctrl-c to exit" + C.reset);
  return L.join("\n");
}

if (asJson) { process.stdout.write(JSON.stringify(history(), null, 2)); process.exit(0); }
if (once) { console.log(render()); process.exit(0); }
process.stdout.write("\x1b[?25l");
const cleanup = () => { process.stdout.write("\x1b[?25h\x1b[0m\n"); process.exit(0); };
process.on("SIGINT", cleanup); process.on("SIGTERM", cleanup);
const tick = () => process.stdout.write("\x1b[H\x1b[2J" + render() + "\n");
tick(); setInterval(tick, 1000);
