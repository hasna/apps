#!/usr/bin/env bun

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

export const CONTRACTS_KIT_VERSION = "0.9.0";

function run(command: string[], cwd: string): string {
  const result = Bun.spawnSync(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new TextDecoder().decode(result.stdout).trim();
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`${command.join(" ")} exited ${result.exitCode}\n${stdout}\n${stderr}`);
  }
  return stdout;
}

export function scannerCommand(archive: string): string[] {
  return ["bunx", `@hasna/contracts@${CONTRACTS_KIT_VERSION}`, "artifact-scan", archive];
}

/** Pack exactly what publish would ship, then scan the tarball rather than src/. */
export function scanPackedArtifact(): { command: string[]; output: string } {
  const repoRoot = join(import.meta.dir, "..");
  const workspace = mkdtempSync(join(tmpdir(), "billing-artifact-scan-"));

  try {
    const packed = run(
      ["bun", "pm", "pack", "--destination", workspace, "--ignore-scripts", "--quiet"],
      repoRoot,
    );
    const archive = isAbsolute(packed) ? packed : join(workspace, packed);
    const command = scannerCommand(archive);
    return { command, output: run(command, repoRoot) };
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const { command, output } = scanPackedArtifact();
  console.log(`$ ${command.join(" ")}`);
  console.log(output);
}
