#!/usr/bin/env bun
/**
 * Scan the PACKED release artifact for internal-infra strings.
 *
 * This is the `scan:artifact` release gate declared in hasna.contract.json
 * (metadata.release.artifactScan) and wired into prepack/prepublishOnly.
 * Run: bun run scan:artifact
 *
 * `contracts artifact-scan` takes a target and refuses to scan src/, so the
 * gate packs first — packing with --ignore-scripts, because the pack that
 * feeds the scan is itself triggered from prepack.
 *
 * The scanner version is pinned here and nowhere else, and stays in lockstep
 * with the manifest kitVersion. There is deliberately no environment
 * override: a gate whose command can be replaced at publish time is the
 * exact bypass the gate exists to close.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

export const CONTRACTS_KIT_VERSION = "0.14.2";

function run(command: string[], cwd: string): string {
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
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

/** Pack the tarball npm would publish, then scan that tarball — never src/. */
export function scanPackedArtifact(): { command: string[]; output: string } {
  const repoRoot = join(import.meta.dir, "..");
  const workspace = mkdtempSync(join(tmpdir(), "paths-artifact-scan-"));

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
  // Echo the resolved command so a scan that ran nothing is visible in publish logs.
  const { command, output } = scanPackedArtifact();
  console.log(`$ ${command.join(" ")}`);
  if (output) console.log(output);
}
