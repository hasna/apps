#!/usr/bin/env bun
/**
 * Scan the PACKED release artifact for bulk asset inventories.
 *
 * This is the `artifact-scan` release gate declared in hasna.contract.json
 * (metadata.release.artifactScan) and wired into prepack. `contracts
 * artifact-scan` refuses to be meaningful against a source tree — it exists to
 * inspect the tarball npm would actually publish — so this script packs that
 * tarball first and scans the archive.
 *
 * The scanner is the `contracts` binary from this repo's own dependency tree,
 * so the version that runs is the one bun.lock pins. Resolving it explicitly
 * (rather than off PATH) keeps a globally installed CLI from silently standing
 * in for the locked kit.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");

function run(command: string[], cwd: string): string {
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const stdout = new TextDecoder().decode(result.stdout).trim();
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`${command.join(" ")} exited ${result.exitCode}\n${stdout}\n${stderr}`.trim());
  }
  return stdout;
}

/** Path to the `contracts` CLI installed for this repo, not one on PATH. */
export function contractsBinPath(repoRoot: string = REPO_ROOT): string {
  const bin = join(repoRoot, "node_modules", ".bin", "contracts");
  if (!existsSync(bin)) {
    throw new Error(`@hasna/contracts is not installed at ${bin}; run 'bun install' before the release gate`);
  }
  return bin;
}

/** Pack the tarball npm would publish, then scan that tarball — never src/. */
export function scanPackedArtifact(repoRoot: string = REPO_ROOT): { command: string[]; output: string } {
  const workspace = mkdtempSync(join(tmpdir(), "clip-artifact-scan-"));
  try {
    // --ignore-scripts: prepack is what calls this gate, so packing again from
    // inside it would recurse.
    const packed = run(["bun", "pm", "pack", "--destination", workspace, "--ignore-scripts", "--quiet"], repoRoot);
    const archive = isAbsolute(packed) ? packed : join(workspace, packed);
    const command = [contractsBinPath(repoRoot), "artifact-scan", archive];
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
