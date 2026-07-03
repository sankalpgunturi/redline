"use strict";
// Shared helpers for redline. No deps - uses the Node that ships with Claude Code.
const fs = require("fs");
const os = require("os");
const path = require("path");

const DIR = path.join(os.homedir(), ".claude", "redline");
function ensureDir() { fs.mkdirSync(DIR, { recursive: true }); }
const cfgPath = (id) => path.join(DIR, `${id}.json`);
const statePath = (id) => path.join(DIR, `${id}.state.json`);
const pendingPath = () => path.join(DIR, "pending.json");
const historyPath = () => path.join(DIR, "history.jsonl");
const planPath = () => path.join(DIR, "plan.json"); // global plan-window snapshot (latest sensor reading, any session)

function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } }
function writeJSON(p, obj) { ensureDir(); fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }
function appendHistory(rec) { ensureDir(); fs.appendFileSync(historyPath(), JSON.stringify(rec) + "\n"); }

function sumFile(p) {
  let total = 0, data;
  try { data = fs.readFileSync(p, "utf8"); } catch { return 0; }
  for (const line of data.split("\n")) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    const u = e.usage || (e.message && e.message.usage);
    if (!u) continue;
    total += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  }
  return total;
}
function sumTranscriptTokens(transcriptPath) {
  if (!transcriptPath) return 0;
  let total = sumFile(transcriptPath);
  const subDir = transcriptPath.replace(/\.jsonl$/, "") + "/subagents";
  try { for (const f of fs.readdirSync(subDir)) if (f.endsWith(".jsonl")) total += sumFile(path.join(subDir, f)); } catch {}
  return total;
}

// Effective time used. Wall-clock UP TO the deadline (counts reading/thinking/idle,
// because the deadline spans prompts). PAST the deadline, only ACTIVE response time
// adds - idle-past-deadline freezes the meter. (turnStart = open turn's start ts;
// overshootSec = accumulated active time past the deadline from completed turns.)
function timeUsedSec(cfg, now, turnStart, overshootSec) {
  if (!cfg.duration_sec) return 0;
  const elapsed = now - cfg.set_at;
  if (elapsed <= cfg.duration_sec) return Math.max(0, elapsed);
  const deadline = cfg.set_at + cfg.duration_sec;
  let over = overshootSec || 0;
  if (turnStart) over += Math.max(0, now - Math.max(turnStart, deadline));
  return cfg.duration_sec + over;
}

// Plan % budgets have two semantics:
// - ceiling (default): "stop when the window hits N% used" - anchored to the plan's
//   CURRENT state, so a half-burned window shows up half-burned from the first render.
// - allowance (plan_rel, set with +N%): "spend N more points from the set-time baseline".
// Returns budget-% remaining under either semantic, or null until the sensor has data.
function planLeft(cfg, planNow, baselinePlan) {
  if (cfg.plan_pct == null || planNow == null) return null;
  if (cfg.plan_rel) return baselinePlan == null ? null : cfg.plan_pct - (planNow - baselinePlan);
  return cfg.plan_pct - planNow;
}

function fractions(cfg, now, r = {}) {
  const f = {};
  if (cfg.duration_sec) f.time = timeUsedSec(cfg, now, r.turnStart, r.overshootSec) / cfg.duration_sec;
  if (cfg.dollars) f.cost = (r.costUsd || 0) / cfg.dollars;
  if (cfg.tokens) f.tokens = (r.tokens || 0) / cfg.tokens;
  const pl = planLeft(cfg, r.planNow, r.baselinePlan);
  if (pl != null) f.plan = Math.max(0, (cfg.plan_pct - pl) / cfg.plan_pct); // never negative when the window slides back down
  const vals = Object.values(f).filter((v) => Number.isFinite(v));
  return { f, overall: vals.length ? Math.max(...vals) : 0 };
}

function burnRate(st, cfg, now) {
  const used = st.tokens || 0, elapsed = now - (cfg.set_at || now);
  return used > 0 && elapsed > 0 ? used / elapsed : null;
}

// Translate the budget into "tokens left" via the session's observed ratios, so the
// binding dimension drives the model's native <total_tokens> pacing. null until data.
function tokensLeft(cfg, st, now) {
  const used = st.tokens || 0, elapsed = now - (cfg.set_at || now);
  const cands = [];
  if (cfg.tokens) cands.push(cfg.tokens - used);
  if (cfg.dollars && st.cost_usd > 0 && used > 0) cands.push((cfg.dollars - st.cost_usd) / (st.cost_usd / used));
  if (cfg.duration_sec && used > 0 && elapsed > 0) {
    const remain = Math.max(0, cfg.duration_sec - timeUsedSec(cfg, now, st.turn_start, st.overshoot_sec));
    cands.push(remain * (used / elapsed));
  }
  if (cfg.plan_pct != null && st.plan_now != null && st.baseline_plan != null) {
    const planUsed = st.plan_now - st.baseline_plan;
    const usedSince = used - (st.baseline_tokens || 0); // same span as planUsed, so the tok/% ratio is honest
    const left = planLeft(cfg, st.plan_now, st.baseline_plan);
    if (planUsed > 0 && usedSince > 0 && left != null) cands.push(left * (usedSince / planUsed));
  }
  const valid = cands.filter((x) => Number.isFinite(x));
  return valid.length ? Math.max(0, Math.round(Math.min(...valid))) : null;
}

const round2 = (x) => Math.round(x * 100) / 100;
function retire(cfg, st, now, reason) {
  st = st || {};
  const r = { costUsd: st.cost_usd || 0, tokens: st.tokens || 0, planNow: st.plan_now, baselinePlan: st.baseline_plan, turnStart: st.turn_start, overshootSec: st.overshoot_sec };
  const { overall } = fractions(cfg, now, r);
  const peak = Math.max(overall, st.peak || 0);
  const elapsed = now - (cfg.set_at || now);
  if (peak <= 0.001 && elapsed < 10) return null;
  const rec = {
    ts: now, session: cfg.session_id || null, reason,
    budget: { duration_sec: cfg.duration_sec || null, dollars: cfg.dollars || null, tokens: cfg.tokens || null, plan_pct: cfg.plan_pct ?? null, plan_rel: cfg.plan_rel ? true : undefined },
    peak: round2(peak),
    final: { overall: round2(overall), cost_usd: round2(r.costUsd), tokens: r.tokens, elapsed_sec: elapsed },
    landed: peak <= 1.0, overshoot_pct: Math.max(0, Math.round((peak - 1) * 100)),
  };
  appendHistory(rec);
  return rec;
}

function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function fmtTokens(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
  return String(Math.round(n));
}

module.exports = {
  DIR, ensureDir, cfgPath, statePath, pendingPath, historyPath, planPath, readJSON, writeJSON, appendHistory,
  sumTranscriptTokens, timeUsedSec, planLeft, fractions, burnRate, tokensLeft, retire, round2, fmtDuration, fmtTokens,
};
