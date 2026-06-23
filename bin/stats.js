#!/usr/bin/env node
"use strict";
// redline stats — local analytics. The one metric that matters: did redline land
// the session within budget (peak usage <= 100%)? Reads ~/.claude/redline/history.jsonl
// (append-only, local only). Usage: node ~/redline/bin/stats.js [--json] [-n N]
const fs = require("fs");
const lib = require("./lib.js");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const nIdx = args.indexOf("-n");
const recentN = nIdx >= 0 ? parseInt(args[nIdx + 1], 10) || 10 : 10;

let rows = [];
try {
  rows = fs.readFileSync(lib.historyPath(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
} catch {}

if (asJson) { process.stdout.write(JSON.stringify(rows, null, 2)); process.exit(0); }

const C = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m" };
const noColor = process.env.NO_COLOR;
const c = (code, s) => (noColor ? s : code + s + C.reset);

if (!rows.length) {
  console.log("redline: no sessions recorded yet.\nRun /redline in Claude Code; outcomes log to ~/.claude/redline/history.jsonl on session end or /redline off.");
  process.exit(0);
}

const n = rows.length;
const landed = rows.filter((r) => r.landed);
const over = rows.filter((r) => !r.landed);
const rate = Math.round((landed.length / n) * 100);
const avgOver = over.length ? Math.round(over.reduce((a, r) => a + r.overshoot_pct, 0) / over.length) : 0;
const worst = over.reduce((a, r) => Math.max(a, r.overshoot_pct), 0);

function dimRate(key) {
  const sub = rows.filter((r) => r.budget && r.budget[key] != null);
  if (!sub.length) return null;
  return `${Math.round((sub.filter((r) => r.landed).length / sub.length) * 100)}% (${sub.length})`;
}

const bar = (pct) => {
  const w = 24, f = Math.round((pct / 100) * w);
  const col = pct >= 90 ? C.green : pct >= 70 ? C.yellow : C.red;
  return c(col, "█".repeat(f)) + c(C.dim, "░".repeat(w - f));
};

console.log("");
console.log(c(C.bold, "  redline · did it land within budget?"));
console.log("");
console.log(`  ${bar(rate)}  ${c(C.bold, rate + "%")} landed  ${c(C.dim, `(${landed.length}/${n} sessions)`)}`);
console.log("");
console.log(`  ${c(C.green, "landed ≤100%")}: ${landed.length}     ${c(C.red, "over budget")}: ${over.length}`);
if (over.length) console.log(`  overshoot when over: avg ${c(C.red, avgOver + "%")} · worst ${c(C.red, worst + "%")}`);
console.log("");
const dims = [["time", "duration_sec"], ["$", "dollars"], ["tokens", "tokens"], ["plan%", "plan_pct"]]
  .map(([label, key]) => [label, dimRate(key)]).filter(([, v]) => v);
if (dims.length) {
  console.log(c(C.dim, "  landed-rate by budget type:"));
  for (const [label, v] of dims) console.log(`    ${label.padEnd(7)} ${v}`);
  console.log("");
}
console.log(c(C.dim, `  recent ${Math.min(recentN, n)}:`));
for (const r of rows.slice(-recentN).reverse()) {
  const b = [];
  if (r.budget.duration_sec) b.push(lib.fmtDuration(r.budget.duration_sec));
  if (r.budget.dollars) b.push("$" + r.budget.dollars);
  if (r.budget.tokens) b.push(lib.fmtTokens(r.budget.tokens) + "tok");
  if (r.budget.plan_pct != null) b.push(r.budget.plan_pct + "%plan");
  const pk = Math.round(r.peak * 100);
  const mark = r.landed ? c(C.green, "✓ landed") : c(C.red, "✗ over  ");
  console.log(`    ${mark}  peak ${String(pk).padStart(3)}%  ${(b.join("+") || "?").padEnd(16)} ${c(C.dim, r.reason)}`);
}
console.log("");
console.log(c(C.dim, `  source: ${lib.historyPath()}  ·  --json for raw`));
