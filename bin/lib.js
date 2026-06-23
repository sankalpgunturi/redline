"use strict";
// Shared helpers for redline. No deps — uses the Node that ships with Claude Code.
const fs = require("fs");
const os = require("os");
const path = require("path");

const DIR = path.join(os.homedir(), ".claude", "redline");

function ensureDir() { fs.mkdirSync(DIR, { recursive: true }); }
const cfgPath = (id) => path.join(DIR, `${id}.json`);
const statePath = (id) => path.join(DIR, `${id}.state.json`);
const pendingPath = () => path.join(DIR, "pending.json");

function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } }
function writeJSON(p, obj) { ensureDir(); fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }

function sumFile(p) {
  let total = 0, data;
  try { data = fs.readFileSync(p, "utf8"); } catch { return 0; }
  for (const line of data.split("\n")) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    const u = e.usage || (e.message && e.message.usage);
    if (!u) continue;
    total += (u.input_tokens || 0) + (u.output_tokens || 0) +
             (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  }
  return total;
}

// Whole-session tokens: main transcript + every fanned subagent transcript.
function sumTranscriptTokens(transcriptPath) {
  if (!transcriptPath) return 0;
  let total = sumFile(transcriptPath);
  const subDir = transcriptPath.replace(/\.jsonl$/, "") + "/subagents";
  try { for (const f of fs.readdirSync(subDir)) if (f.endsWith(".jsonl")) total += sumFile(path.join(subDir, f)); } catch {}
  return total;
}

function fractions(cfg, now, { costUsd = 0, tokens = 0, planNow = null, baselinePlan = null } = {}) {
  const f = {};
  if (cfg.duration_sec) f.time = (now - cfg.set_at) / cfg.duration_sec;
  if (cfg.dollars) f.cost = costUsd / cfg.dollars;
  if (cfg.tokens) f.tokens = tokens / cfg.tokens;
  if (cfg.plan_pct != null && planNow != null && baselinePlan != null) f.plan = (planNow - baselinePlan) / cfg.plan_pct;
  const vals = Object.values(f).filter((v) => Number.isFinite(v));
  return { f, overall: vals.length ? Math.max(...vals) : 0 };
}

// Observed burn rate, tokens/sec (null until there's data).
function burnRate(st, cfg, now) {
  const used = st.tokens || 0;
  const elapsed = now - (cfg.set_at || now);
  return used > 0 && elapsed > 0 ? used / elapsed : null;
}

// Translate the budget into "tokens left" using the session's OWN observed ratios
// (tokens are the common currency). Returns the BINDING dimension's token-equivalent
// — the format the model is natively tuned to (Anthropic's taskBudget / <total_tokens>).
// Returns null until there's enough observed data to translate.
function tokensLeft(cfg, st, now) {
  const used = st.tokens || 0;
  const elapsed = now - (cfg.set_at || now);
  const cands = [];
  if (cfg.tokens) cands.push(cfg.tokens - used);
  if (cfg.dollars && st.cost_usd > 0 && used > 0) cands.push((cfg.dollars - st.cost_usd) / (st.cost_usd / used));
  if (cfg.duration_sec && used > 0 && elapsed > 0) cands.push((cfg.duration_sec - elapsed) * (used / elapsed));
  if (cfg.plan_pct != null && st.plan_now != null && st.baseline_plan != null) {
    const planUsed = st.plan_now - st.baseline_plan;
    if (planUsed > 0 && used > 0) cands.push((cfg.plan_pct - planUsed) * (used / planUsed));
  }
  const valid = cands.filter((x) => Number.isFinite(x));
  return valid.length ? Math.max(0, Math.round(Math.min(...valid))) : null;
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


const round2 = (x) => Math.round(x * 100) / 100;
const historyPath = () => path.join(DIR, "history.jsonl");

function appendHistory(rec) {
  ensureDir();
  fs.appendFileSync(historyPath(), JSON.stringify(rec) + "\n");
}

// Record the outcome of a retiring budget. The metric: did it land within budget
// (peak usage <= 100%)? Logged locally only — append-only JSONL, no network.
function retire(cfg, st, now, reason) {
  st = st || {};
  const r = { costUsd: st.cost_usd || 0, tokens: st.tokens || 0, planNow: st.plan_now, baselinePlan: st.baseline_plan };
  const { overall } = fractions(cfg, now, r);
  const peak = Math.max(overall, st.peak || 0);
  const elapsed = now - (cfg.set_at || now);
  // skip trivial no-op budgets (set then immediately cleared, never used)
  if (peak <= 0.001 && elapsed < 10) return null;
  const rec = {
    ts: now, session: cfg.session_id || null, reason,
    budget: { duration_sec: cfg.duration_sec || null, dollars: cfg.dollars || null, tokens: cfg.tokens || null, plan_pct: cfg.plan_pct ?? null },
    peak: round2(peak),
    final: { overall: round2(overall), cost_usd: round2(r.costUsd), tokens: r.tokens, elapsed_sec: elapsed },
    landed: peak <= 1.0,
    overshoot_pct: Math.max(0, Math.round((peak - 1) * 100)),
  };
  appendHistory(rec);
  return rec;
}

module.exports = {
  DIR, ensureDir, cfgPath, statePath, pendingPath, readJSON, writeJSON,
  sumTranscriptTokens, fractions, burnRate, tokensLeft, fmtDuration, fmtTokens, round2, historyPath, appendHistory, retire,
};
