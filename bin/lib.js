"use strict";
// Shared helpers for redline. No deps — uses the Node that ships with Claude Code.
const fs = require("fs");
const os = require("os");
const path = require("path");

const DIR = path.join(os.homedir(), ".claude", "redline");

function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true });
}

const cfgPath = (id) => path.join(DIR, `${id}.json`);
const statePath = (id) => path.join(DIR, `${id}.state.json`);
const pendingPath = () => path.join(DIR, "pending.json");

function readJSON(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeJSON(p, obj) {
  ensureDir();
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

// Sum tokens billed across all assistant turns in a transcript .jsonl.
// ponytail: O(n) scan of the file per call; transcripts are small enough that
// this is fine. Cache by mtime if a session ever gets huge.
function sumTranscriptTokens(transcriptPath) {
  if (!transcriptPath) return 0;
  let total = 0;
  let data;
  try {
    data = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return 0;
  }
  for (const line of data.split("\n")) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const u = e.usage || (e.message && e.message.usage);
    if (!u) continue;
    total +=
      (u.input_tokens || 0) +
      (u.output_tokens || 0) +
      (u.cache_creation_input_tokens || 0) +
      (u.cache_read_input_tokens || 0);
  }
  return total;
}

// Given a config + live readings, return the consumed fraction (0..1+) per
// configured dimension and the overall (max) fraction.
function fractions(cfg, now, { costUsd = 0, tokens = 0, planNow = null, baselinePlan = null } = {}) {
  const f = {};
  if (cfg.duration_sec) f.time = (now - cfg.set_at) / cfg.duration_sec;
  if (cfg.dollars) f.cost = costUsd / cfg.dollars;
  if (cfg.tokens) f.tokens = tokens / cfg.tokens;
  if (cfg.plan_pct != null && planNow != null && baselinePlan != null) {
    f.plan = (planNow - baselinePlan) / cfg.plan_pct;
  }
  const vals = Object.values(f).filter((v) => Number.isFinite(v));
  const overall = vals.length ? Math.max(...vals) : 0;
  return { f, overall };
}

function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtTokens(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
  return String(n);
}

module.exports = {
  DIR, ensureDir, cfgPath, statePath, pendingPath,
  readJSON, writeJSON, sumTranscriptTokens, fractions, fmtDuration, fmtTokens,
};
