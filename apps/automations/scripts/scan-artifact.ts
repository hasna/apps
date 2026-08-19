#!/usr/bin/env bun
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runContracts } from "./contracts-cli.mjs";

const tempDir = mkdtempSync(join(tmpdir(), "automations-artifact-scan-"));

function run(command: string[], label: string): string {
  const result = Bun.spawnSync({
    cmd: command,
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  if (!result.success) {
    if (stdout.trim()) process.stdout.write(stdout);
    if (stderr.trim()) process.stderr.write(stderr);
    throw new Error(`${label} failed with exit code ${result.exitCode}`);
  }
  if (stderr.trim()) process.stderr.write(stderr);
  return stdout;
}

try {
  run([
    "bun",
    "pm",
    "pack",
    "--destination",
    tempDir,
    "--ignore-scripts",
    "--quiet",
  ], "bun pm pack");

  const artifact = readdirSync(tempDir).find((entry) => entry.endsWith(".tgz") || entry.endsWith(".tar.gz"));
  if (!artifact) {
    throw new Error("bun pm pack did not create a packed artifact");
  }

  const scanStatus = runContracts(["artifact-scan", join(tempDir, artifact)], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  if (scanStatus !== 0) process.exit(scanStatus);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
