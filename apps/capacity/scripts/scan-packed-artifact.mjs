#!/usr/bin/env bun

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const workspace = mkdtempSync(join(tmpdir(), "capacity-artifact-scan-"));
const decoder = new TextDecoder();

function run(command, options = {}) {
  const result = Bun.spawnSync(command, {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    ...options,
  });
  const stdout = decoder.decode(result.stdout).trim();
  const stderr = decoder.decode(result.stderr).trim();
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(" ")} exited ${result.exitCode}\n${stdout}\n${stderr}`.trim());
  }
  return stdout;
}

try {
  const packed = run(["bun", "pm", "pack", "--destination", workspace, "--ignore-scripts", "--quiet"]);
  const archive = isAbsolute(packed) ? packed : join(workspace, packed);
  const contracts = Bun.which("contracts");
  const scanCommand =
    contracts === null
      ? ["bunx", "@hasna/contracts@0.8.1", "artifact-scan", archive]
      : [contracts, "artifact-scan", archive];
  run([...scanCommand, "--manifest", join(repoRoot, "hasna.contract.json")], {
    stdout: "inherit",
    stderr: "inherit",
  });
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
