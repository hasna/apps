#!/usr/bin/env bun
/**
 * Pack this repo the way `npm publish` would, then scan what actually shipped.
 *
 * Scans the TARBALL, never `src/` — a source-directory scan reports on files
 * that may never be published and misses built output that is. Wired into
 * `prepack` (metadata.release.artifactScan in hasna.contract.json).
 *
 * Packing uses `--ignore-scripts`: without it, packing from inside `prepack`
 * re-enters `prepack` forever. The scanner is the `contracts` binary from the
 * pinned dependency, not `bunx` — an unpinned package runner resolves to
 * whatever is newest at publish time, and a resolution failure silently
 * becomes a non-run.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

function run(command, cwd) {
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const stdout = new TextDecoder().decode(result.stdout).trim();
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`${command.join(" ")} exited ${result.exitCode}\n${stdout}\n${stderr}`);
  }
  return stdout;
}

const repoRoot = join(import.meta.dir, "..");
const workspace = mkdtempSync(join(tmpdir(), "conversations-artifact-scan-"));

try {
  const packed = run(["bun", "pm", "pack", "--destination", workspace, "--ignore-scripts", "--quiet"], repoRoot);
  const archive = isAbsolute(packed) ? packed : join(workspace, packed);

  const scanner = join(repoRoot, "node_modules", ".bin", "contracts");
  const result = Bun.spawnSync([scanner, "artifact-scan", archive], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "inherit",
  });
  // The verdict goes to STDERR, never stdout: `npm pack` runs prepack with its
  // stdout captured into pack output, and the pack's `--json` consumers must
  // receive a clean JSON document (the packed-local-read-worker regression test
  // parses `npm pack --dry-run --json`).
  const verdict = new TextDecoder().decode(result.stdout).trim();
  if (result.exitCode !== 0) {
    if (verdict) console.error(verdict);
    console.error(
      "\nA published artifact must not carry a bulk asset inventory. See @hasna/contracts CONTRACT.md clause B.",
    );
    process.exit(result.exitCode ?? 1);
  }
  if (verdict) console.error(verdict);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
