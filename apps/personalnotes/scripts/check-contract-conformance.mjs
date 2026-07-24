#!/usr/bin/env bun
// Contracts conformance gate for the Personal Notes OSS core.
//
// Runs @hasna/contracts' runRepoConformance against this repo's hasna.contract.json
// and package.json. Exits non-zero when any check fails so CI (and `bun run
// check:contracts`) enforces manifest/schema/no-cloud/storage-mode alignment.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runRepoConformance } from "@hasna/contracts";

export const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

// Local (SQLite) is the user-hosted default runtime placement for the OSS core.
const conformanceEnv = { HASNA_PERSONALNOTES_STORAGE_MODE: "local" };

export function runContractConformance(root = repoRoot) {
  return runRepoConformance(root, { env: conformanceEnv });
}

export function formatContractConformance(report) {
  return `${JSON.stringify(
    report,
    (key, value) => (key === "repoRoot" ? "." : value),
    2,
  )}\n`;
}

if (import.meta.main) {
  const report = runContractConformance();
  process.stdout.write(formatContractConformance(report));
  if (!report.ok) process.exit(1);
}
