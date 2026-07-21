#!/usr/bin/env bun
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runRepoConformance } from "@hasna/contracts";

export const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function runContractConformance(root = repoRoot) {
  return runRepoConformance(root, { env: {} });
}

export function formatContractConformance(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

if (import.meta.main) {
  const report = runContractConformance();
  process.stdout.write(formatContractConformance(report));
  if (!report.ok) process.exitCode = 1;
}
