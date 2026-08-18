#!/usr/bin/env bun
// Pack this repo the way `npm publish` would, then scan what actually shipped.
//
// This is the contract's clause-B release gate (metadata.release.artifactScan
// in hasna.contract.json). It packs to a temp directory with `--ignore-scripts`
// — without that, packing from inside `prepack` would re-enter `prepack`
// forever — and scans the TARBALL, never `src/`.
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "calendar-artifact-scan-"));

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
  run(
    ["bun", "pm", "pack", "--destination", tempDir, "--ignore-scripts", "--quiet"],
    "bun pm pack",
  );

  const artifact = readdirSync(tempDir).find(
    (entry) => entry.endsWith(".tgz") || entry.endsWith(".tar.gz"),
  );
  if (!artifact) {
    throw new Error("bun pm pack did not create a packed artifact");
  }

  const output = run(
    ["contracts", "artifact-scan", join(tempDir, artifact)],
    "contracts artifact-scan",
  );
  // Report to stderr: prepack runs inside `npm pack`/`npm publish`, and a
  // gate report on stdout corrupts `--json` consumers of the pack output.
  process.stderr.write(output);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
