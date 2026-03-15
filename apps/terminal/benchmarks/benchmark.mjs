#!/usr/bin/env bun
// Reproducible benchmark: measures token savings across real commands
// Run: bun benchmarks/benchmark.mjs

import { compress, stripAnsi } from "../dist/compression.js";
import { parseOutput, estimateTokens, tokenSavings } from "../dist/parsers/index.js";
import { searchContent } from "../dist/search/index.js";
import { diffOutput, clearDiffCache } from "../dist/diff-cache.js";
import { smartDisplay } from "../dist/smart-display.js";
import { stripNoise } from "../dist/noise-filter.js";
import { rewriteCommand } from "../dist/command-rewriter.js";
import { execSync } from "child_process";

const cwd = process.cwd();
const run = (cmd) => { try { return execSync(cmd, { encoding: "utf8", cwd, maxBuffer: 10*1024*1024 }).trim(); } catch(e) { return e.stdout?.trim() ?? ""; } };

let totalRaw = 0, totalSaved = 0;
const rows = [];

function track(name, rawText, compressedText) {
  const raw = estimateTokens(rawText);
  const comp = estimateTokens(compressedText);
  const saved = Math.max(0, raw - comp);
  totalRaw += raw;
  totalSaved += saved;
  rows.push({ name, raw, comp, saved, pct: raw > 0 ? Math.round(saved/raw*100) : 0 });
}

console.log("open-terminal benchmark — measuring real token savings\n");

// 1. Noise filter on npm install-like output
const npmSim = "added 847 packages in 12s\n\n143 packages are looking for funding\n  run `npm fund` for details\n\nfound 0 vulnerabilities\n";
const npmClean = stripNoise(npmSim).cleaned;
track("npm install (noise filter)", npmSim, npmClean);

// 2. Command rewriting
const rwTests = [
  ["find . -name '*.ts' | grep -v node_modules", "find pipe→filter"],
  ["cat package.json | grep name", "cat pipe→grep"],
  ["git log", "git log→oneline"],
  ["npm ls", "npm ls→depth0"],
];
for (const [cmd, label] of rwTests) {
  const rw = rewriteCommand(cmd);
  if (rw.changed) {
    const rawOut = run(cmd) || cmd;
    const rwOut = run(rw.rewritten) || rw.rewritten;
    track(`rewrite: ${label}`, rawOut, rwOut);
  }
}

// 3. Structured parsing
const gitStatus = run("git status");
const gsParsed = parseOutput("git status", gitStatus);
if (gsParsed) track("git status (structured)", gitStatus, JSON.stringify(gsParsed.data));

const gitLog = run("git log -15");
const glParsed = parseOutput("git log -15", gitLog);
if (glParsed) track("git log -15 (structured)", gitLog, JSON.stringify(glParsed.data));

// 4. Token budget compression
const bigLs = run("ls -laR src/");
const c1 = compress("ls -laR src/", bigLs, { maxTokens: 150 });
track("ls -laR src/ (budget 150)", bigLs, c1.content);

// 5. Search overflow guard
const rawGrep = run("grep -rn export src/ | head -200");
const search = await searchContent("export", cwd, { maxResults: 10 });
track("grep export (overflow guard)", rawGrep, JSON.stringify(search));

// 6. Smart display on paths
const findPng = run("find . -name '*.png' -not -path '*/node_modules/*' 2>/dev/null | head -50");
if (findPng) {
  const display = smartDisplay(findPng.split("\n"));
  track("find *.png (smart display)", findPng, display.join("\n"));
}

// 7. Diff caching (identical re-run)
clearDiffCache();
const testOut = run("bun test 2>&1");
diffOutput("bun test", cwd, testOut);
const d2 = diffOutput("bun test", cwd, testOut);
track("bun test (identical re-run)", testOut, d2.diffSummary);

// 8. Diff caching (fuzzy — simulated 95% similar)
clearDiffCache();
const testA = "PASS test1\nPASS test2\nPASS test3\nPASS test4\nPASS test5\nPASS test6\nPASS test7\nPASS test8\nPASS test9\nFAIL test10\nTests: 9 passed, 1 failed";
const testB = "PASS test1\nPASS test2\nPASS test3\nPASS test4\nPASS test5\nPASS test6\nPASS test7\nPASS test8\nPASS test9\nPASS test10\nTests: 10 passed, 0 failed";
diffOutput("test", "/tmp", testA);
const fuzzyDiff = diffOutput("test", "/tmp", testB);
track("test (fuzzy diff, 1 change)", testA, fuzzyDiff.added.join("\n") + "\n" + fuzzyDiff.removed.join("\n"));

// 9. Budget compression on large ls
const bigLs2 = run("ls -laR . 2>/dev/null | head -300");
const c2 = compress("ls -laR .", bigLs2, { maxTokens: 100 });
track("ls -laR . (budget 100, 300 lines)", bigLs2, c2.content);

// Print results
console.log("┌─────────────────────────────────────────────┬──────┬──────┬───────┬──────┐");
console.log("│ Scenario                                    │  Raw │ Comp │ Saved │    % │");
console.log("├─────────────────────────────────────────────┼──────┼──────┼───────┼──────┤");
for (const r of rows) {
  console.log("│ " + r.name.padEnd(43) + " │ " + String(r.raw).padStart(4) + " │ " + String(r.comp).padStart(4) + " │ " + String(r.saved).padStart(5) + " │ " + (r.pct + "%").padStart(4) + " │");
}
console.log("├─────────────────────────────────────────────┼──────┼──────┼───────┼──────┤");
const pct = Math.round(totalSaved/totalRaw*100);
console.log("│ " + "TOTAL".padEnd(43) + " │ " + String(totalRaw).padStart(4) + " │ " + String(totalRaw-totalSaved).padStart(4) + " │ " + String(totalSaved).padStart(5) + " │ " + (pct + "%").padStart(4) + " │");
console.log("└─────────────────────────────────────────────┴──────┴──────┴───────┴──────┘");

// Cost analysis
const sonnetRate = 3.0;
const cerebrasInputRate = 0.60;
const savingsUsd = totalSaved * sonnetRate / 1_000_000;
console.log(`\nAt Claude Sonnet $3/M: ${totalSaved} tokens saved = $${savingsUsd.toFixed(6)}`);
console.log(`At 500 commands/day: ~$${(savingsUsd * 50).toFixed(2)}/day, $${(savingsUsd * 50 * 30).toFixed(0)}/month saved`);
