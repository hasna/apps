#!/usr/bin/env bun
// Reproducible adversarial benchmark.
// Run after building: bun run build && bun benchmarks/benchmark.mjs

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { formatAdversarialReport, runAdversarialBenchmark } from "../dist/adversarial-benchmark.js";

const builtModule = join(process.cwd(), "dist", "adversarial-benchmark.js");
if (!existsSync(builtModule)) {
  console.error("dist/adversarial-benchmark.js not found. Run: bun run build");
  process.exit(1);
}

const variantArg = process.argv.find((arg) => arg.startsWith("--variant="));
const variant = variantArg?.split("=")[1] ?? "indexed";
if (!["baseline", "progressive", "indexed"].includes(variant)) {
  console.error("Invalid variant. Use --variant=baseline, --variant=progressive, or --variant=indexed");
  process.exit(1);
}

const realCliReportArg = process.argv.find((arg) => arg.startsWith("--real-cli-report="));
let realCliGate;
if (realCliReportArg) {
  const reportPath = realCliReportArg.split("=")[1];
  const realReport = JSON.parse(readFileSync(reportPath, "utf8"));
  realCliGate = {
    target90Achieved: Boolean(realReport.totals?.target90Achieved),
    weightedTokenReduction: Number(realReport.totals?.weightedTokenReduction ?? 0),
    qualityFailures: Number(realReport.totals?.qualityFailures ?? 0),
    floorFailures: Number(realReport.totals?.floorFailures ?? 0),
    installedBinaryUsed: Boolean(realReport.totals?.installedBinaryUsed),
    reposCovered: realReport.totals?.reposCovered ?? [],
    workflowCount: Number(realReport.totals?.workflowCount ?? 0),
  };
}

const report = runAdversarialBenchmark(variant, { realCliGate });
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  if (process.argv.includes("--compare")) {
    const baseline = runAdversarialBenchmark("baseline", { realCliGate });
    const progressive = runAdversarialBenchmark("progressive", { realCliGate });
    const indexed = runAdversarialBenchmark("indexed", { realCliGate });
    console.log(`Baseline token reduction: ${(baseline.totals.weightedTokenReduction * 100).toFixed(1)}%`);
    console.log(`Progressive token reduction: ${(progressive.totals.weightedTokenReduction * 100).toFixed(1)}%`);
    console.log(`Indexed token reduction: ${(indexed.totals.weightedTokenReduction * 100).toFixed(1)}%`);
    console.log("");
  }
  console.log(formatAdversarialReport(report));
}
