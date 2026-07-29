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

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { formatArtifactScanReport, scanPublishedArtifact } from "@hasna/contracts/artifact-scan";

function run(command: string[], cwd: string): string {
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const stdout = new TextDecoder().decode(result.stdout).trim();
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`${command.join(" ")} exited ${result.exitCode}\n${stdout}\n${stderr}`);
  }
  return stdout;
}

const repoRoot = join(import.meta.dir, "..");
const workspace = mkdtempSync(join(tmpdir(), "open-otp-artifact-scan-"));

try {
  const packed = run(["bun", "pm", "pack", "--destination", workspace, "--ignore-scripts", "--quiet"], repoRoot);
  const archive = isAbsolute(packed) ? packed : join(workspace, packed);
  const report = scanPublishedArtifact(archive);
  console.log(formatArtifactScanReport(report));
  if (!report.ok) {
    console.error("\nA published artifact must not carry a bulk asset inventory.");
    process.exit(1);
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
