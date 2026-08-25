#!/usr/bin/env bun
/**
 * Resolve and run the pinned @hasna/contracts CLI from the installed
 * package (never from the registry), so scripts like artifact-scan use the
 * exact devDependency version the lockfile pins.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveContractsCli() {
  const packageJsonPath = fileURLToPath(import.meta.resolve("@hasna/contracts/package.json"));
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const bin = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.contracts;

  if (typeof bin !== "string" || bin.length === 0) {
    throw new Error("@hasna/contracts does not declare the contracts CLI");
  }

  return resolve(dirname(packageJsonPath), bin);
}

export function runContracts(args, options = {}) {
  let cli;
  try {
    cli = resolveContractsCli();
  } catch (error) {
    console.error(
      `Unable to resolve the pinned @hasna/contracts CLI: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }

  const result = spawnSync(process.execPath, [cli, ...args], {
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    console.error(`Unable to run the pinned @hasna/contracts CLI: ${result.error.message}`);
    return 1;
  }

  return result.status ?? 1;
}

if (import.meta.main) {
  process.exit(runContracts(process.argv.slice(2)));
}
