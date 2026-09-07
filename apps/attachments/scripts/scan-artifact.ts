#!/usr/bin/env bun
/**
 * Scan the PACKED release artifact for bulk asset inventories.
 *
 * This is the `scan:artifact` release gate declared in hasna.contract.json
 * (metadata.release.artifactScan) and wired into prepack/prepublishOnly.
 * Run: bun run scan:artifact
 *
 * The scanner version is pinned here and nowhere else (pinned to the same
 * published @hasna/contracts 1.0.2 the client resolver comes from). There is
 * deliberately no environment override: a gate whose command can be replaced
 * at publish time is the exact bypass the gate exists to close.
 * scan-artifact.test.ts asserts the pin stays in lockstep with
 * hasna.contract.json, the vendored storage kit provenance and the
 * @hasna/contracts devDependency pin.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

export const CONTRACTS_KIT_VERSION = "1.0.2";

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

/**
 * Pack the tarball npm would publish into a scratch workspace and return the
 * archive path. Exposed so the release-gate tests can scan the SAME tarball
 * the scanner scans.
 */
export function packArtifact(): { workspace: string; archive: string } {
  const repoRoot = join(import.meta.dir, "..");
  const workspace = mkdtempSync(join(tmpdir(), "attachments-artifact-"));
  const packed = run(["bun", "pm", "pack", "--destination", workspace, "--ignore-scripts", "--quiet"], repoRoot);
  return { workspace, archive: isAbsolute(packed) ? packed : join(workspace, packed) };
}

/** Pack the tarball npm would publish, then scan that tarball — never src/. */
export function scanPackedArtifact(): { command: string[]; output: string } {
  const repoRoot = join(import.meta.dir, "..");
  const { workspace, archive } = packArtifact();
  try {
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
  console.log(output);
}
