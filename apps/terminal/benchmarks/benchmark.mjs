#!/usr/bin/env bun
// Reproducible adversarial benchmark.
// Run after building: bun run build && bun benchmarks/benchmark.mjs

import { existsSync } from "fs";
import { join } from "path";
import { formatAdversarialReport, runAdversarialBenchmark } from "../dist/adversarial-benchmark.js";

const builtModule = join(process.cwd(), "dist", "adversarial-benchmark.js");
if (!existsSync(builtModule)) {
  console.error("dist/adversarial-benchmark.js not found. Run: bun run build");
  process.exit(1);
}

const report = runAdversarialBenchmark();
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatAdversarialReport(report));
}
