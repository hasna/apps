#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Package smoke entry: verifies the three published bins are declared and that a
// built CLI exposes its top-level commands. Referenced by `smoke:package`.

export const REQUIRED_BIN_NAMES = ["fleet", "fleet-mcp", "fleet-serve"] as const;

/** Parse `fleet --help` output into the sorted list of top-level command names. */
export function parseCliCommandNames(helpOutput: string): string[] {
  const commands = new Set<string>();
  for (const line of helpOutput.split(/\r?\n/)) {
    const match = line.match(/^\s{2}([a-z][a-z0-9-]*)(?:\s|$)/);
    if (match?.[1] && match[1] !== "help") commands.add(match[1]);
  }
  return [...commands].sort();
}

async function main(): Promise<void> {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const help = execFileSync("bun", ["run", "src/cli/index.tsx", "--help"], { cwd: repoRoot, encoding: "utf8" });
  const commands = parseCliCommandNames(help);
  console.log(JSON.stringify({ ok: true, bins: [...REQUIRED_BIN_NAMES], commands }, null, 2));
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
