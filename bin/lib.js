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
const globalPath = () => path.join(DIR, "global.json"); // machine-wide fleet budget (plan-window ceiling, all sessions)
const notifyPath = () => path.join(DIR, "notify.on"); // marker file: tier-transition notifications enabled

function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } }
function writeJSON(p, obj) { ensureDir(); fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }
function appendHistory(rec) { ensureDir(); fs.appendFileSync(historyPath(), JSON.stringify(rec) + "\n"); }

function sumFile(p, acc) {
  let data;
  try { data = fs.readFileSync(p, "utf8"); } catch { return; }
  for (const line of data.split("\n")) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    const u = e.usage || (e.message && e.message.usage);
    if (!u) continue;
    const nc = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
    acc.nc += nc; // non-cache: what the rate limiter actually weighs
    acc.total += nc + (u.cache_read_input_tokens || 0);
  }
}
// Returns {total, nc}: total includes cache reads (redline's own token budgets count
// them - they are real context volume); nc excludes them (for plan-% ratios, where
// cache reads are nearly free against the limit and would inflate 1% to absurdity).
function sumTranscriptTokens(transcriptPath) {
  const acc = { total: 0, nc: 0 };
  if (!transcriptPath) return acc;
  sumFile(transcriptPath, acc);
  const subDir = transcriptPath.replace(/\.jsonl$/, "") + "/subagents";
  try { for (const f of fs.readdirSync(subDir)) if (f.endsWith(".jsonl")) sumFile(path.join(subDir, f), acc); } catch {}
  return acc;
}

// Last "LANDING: ..." line in the transcript's assistant messages - the model's own
// manifest of what it delivered vs cut when it wrapped up under budget pressure.
function lastLanding(transcriptPath) {
  let data;
  try { data = fs.readFileSync(transcriptPath, "utf8"); } catch { return null; }
  let found = null;
  for (const line of data.split("\n")) {
    if (!line.includes("LANDING:")) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    const msg = e.message || e;
    if ((e.type || msg.role) !== "assistant" && msg.role !== "assistant") continue;
    const blocks = Array.isArray(msg.content) ? msg.content : [{ text: String(msg.content || "") }];
    for (const b of blocks) {
      const m = typeof b.text === "string" && b.text.match(/LANDING:\s*(.+)/);
      if (m) found = m[1].trim().slice(0, 200);
    }
  }
  return found;
}

// Fleet budget fraction: the shared plan window against the machine-wide ceiling.
// Needs a fresh sensor reading (any interactive session refreshes plan.json every
// second); stale data must not lock anyone out, so > 15 min old means "no reading".
function fleetFraction(g, snap, now) {
  if (!g || g.plan_pct == null || !snap || !snap.ts || now - snap.ts > 900) return null;
  const p = snap[g.plan_window || "five_hour"];
  return p ? p.pct / g.plan_pct : null;
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

// Median burn across finished sessions (history.jsonl), for the set-time forecast.
// null until there are 3 usable sessions - no forecast beats a made-up one.
function typicalBurn() {
  let recs = [];
  try { recs = fs.readFileSync(historyPath(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch {}
  const ok = recs.filter((r) => r.final && r.final.elapsed_sec > 60);
  if (ok.length < 3) return null;
  const med = (a) => { const s = a.filter((x) => Number.isFinite(x) && x > 0).sort((x, y) => x - y); return s.length ? s[(s.length - 1) >> 1] : null; };
  return {
    n: ok.length,
    tokMin: med(ok.map((r) => r.final.tokens / (r.final.elapsed_sec / 60))),
    usdMin: med(ok.map((r) => r.final.cost_usd / (r.final.elapsed_sec / 60))),
  };
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
    denials: st.denials || 0,               // reserve-zone tool blocks: 0 = the model wrapped up on its own
    clean: peak <= 1.0 && !(st.denials || 0), // landed without the lock ever firing
    landing: st.landing || undefined,       // the model's own "delivered X; cut Y" manifest
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
  DIR, ensureDir, cfgPath, statePath, pendingPath, historyPath, planPath, globalPath, notifyPath, readJSON, writeJSON, appendHistory,
  sumTranscriptTokens, lastLanding, fleetFraction, timeUsedSec, planLeft, fractions, burnRate, typicalBurn, tokensLeft, retire, round2, fmtDuration, fmtTokens,
};
