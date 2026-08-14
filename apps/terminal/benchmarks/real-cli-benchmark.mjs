#!/usr/bin/env bun
// Real installed-CLI benchmark. This executes raw shell commands and the actual
// `terminal` binary, then applies quality/floor gates before any 90% claim.

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import {
  formatRealCliBenchmarkReport,
  runRealCliBenchmark,
} from "../dist/real-cli-benchmark.js";

const builtModule = join(process.cwd(), "dist", "real-cli-benchmark.js");
if (!existsSync(builtModule)) {
  console.error("dist/real-cli-benchmark.js not found. Run: bun run build");
  process.exit(1);
}

const json = process.argv.includes("--json");
const outputArg = process.argv.find((arg) => arg.startsWith("--output="));
const outputPath = outputArg?.split("=")[1];
const openTerminalPath = process.argv.find((arg) => arg.startsWith("--open-terminal="))?.split("=")[1];
const iappLogosPath = process.argv.find((arg) => arg.startsWith("--iapp-logos="))?.split("=")[1];

const repoPaths = {
  ...(openTerminalPath ? { "open-terminal": openTerminalPath } : {}),
  ...(iappLogosPath ? { "iapp-logos": iappLogosPath } : {}),
};

const report = runRealCliBenchmark({ repoPaths });

if (outputPath) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(report, null, 2));
}

console.log(json ? JSON.stringify(report, null, 2) : formatRealCliBenchmarkReport(report));
process.exit(report.totals.target90Achieved ? 0 : 2);
