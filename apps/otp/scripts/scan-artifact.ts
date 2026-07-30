// Pack this repo the way `npm publish` would, then scan what actually shipped.
//
// This is the release gate `prepack` runs. It packs to a temp directory with
// `--ignore-scripts` — without that, packing from inside `prepack` would
// re-enter `prepack` forever.
//
// It scans the TARBALL, never `src/`: what a file looks like in the repo says
// nothing about what ends up in the published artifact, because `files` and the
// bundler both rewrite that set.
//
// The kit is a pinned devDependency and is imported directly. A `npx`/`bunx`
// invocation would resolve a different version on every machine — under this
// fleet's minimum-release-age policy it silently resolves an older release that
// does not carry this command at all.
//
// The pieces below are exported, and the entry point takes an optional target,
// so `tests/release-gate.test.ts` can run this exact file against a poisoned
// tarball and watch it exit non-zero. A gate whose failing path nothing
// exercises can be switched off without a single test turning red — which is
// the only way this file is ever wrong.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import {
  type ArtifactScanReport,
  formatArtifactScanReport,
  scanPublishedArtifact,
} from "@hasna/contracts/artifact-scan";

/** Message printed on the failing path, and asserted on by the gate's tests. */
export const GATE_FAILURE_MESSAGE = "A published artifact must not carry a bulk asset inventory.";

function run(command: string[], cwd: string): string {
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const stdout = new TextDecoder().decode(result.stdout).trim();
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`${command.join(" ")} exited ${result.exitCode}\n${stdout}\n${stderr}`);
  }
  return stdout;
}

/** Pack this repo into a throwaway workspace and scan the tarball that comes out. */
export function scanRepoArtifact(): ArtifactScanReport {
  const repoRoot = join(import.meta.dir, "..");
  const workspace = mkdtempSync(join(tmpdir(), "open-otp-artifact-scan-"));

  try {
    const packed = run(["bun", "pm", "pack", "--destination", workspace, "--ignore-scripts", "--quiet"], repoRoot);
    const archive = isAbsolute(packed) ? packed : join(workspace, packed);
    return scanPublishedArtifact(archive);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

/** Fail closed: anything short of a clean scan stops the publish. */
export function gateExitCode(report: ArtifactScanReport): number {
  return report.ok ? 0 : 1;
}

/**
 * Scan `target` when one is given, otherwise pack this repo and scan that.
 * Passing a target is how the failing path gets exercised without poisoning
 * the repo itself.
 */
export function runGate(target?: string): number {
  const report = target === undefined ? scanRepoArtifact() : scanPublishedArtifact(target);
  console.log(formatArtifactScanReport(report));

  const exitCode = gateExitCode(report);
  if (exitCode !== 0) {
    console.error(`\n${GATE_FAILURE_MESSAGE}`);
  }
  return exitCode;
}

if (import.meta.main) {
  process.exit(runGate(process.argv[2]));
}
