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

const variantArg = process.argv.find((arg) => arg.startsWith("--variant="));
const variant = variantArg?.split("=")[1] ?? "progressive";
if (!["baseline", "progressive"].includes(variant)) {
  console.error("Invalid variant. Use --variant=baseline or --variant=progressive");
  process.exit(1);
}

const report = runAdversarialBenchmark(variant);
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  if (process.argv.includes("--compare")) {
    const baseline = runAdversarialBenchmark("baseline");
    console.log(`Baseline token reduction: ${(baseline.totals.weightedTokenReduction * 100).toFixed(1)}%`);
    console.log(`Progressive token reduction: ${(report.totals.weightedTokenReduction * 100).toFixed(1)}%`);
    console.log("");
  }
  console.log(formatAdversarialReport(report));
}
