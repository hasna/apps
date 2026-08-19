// Pack this repo the way `npm publish` would, then scan what actually shipped.
//
// It scans the TARBALL, never `src/`. `contracts artifact-scan` accepts a
// directory for local iteration, and pointing it at the repo root is the
// tempting shortcut — but it reports on files that may never be published and
// misses built output that is, so a source-tree scan is a gate that cannot fail
// for the case it exists to catch. The CLI labels the two modes `source_tree`
// and `packed_artifact` precisely because they are not interchangeable.
//
// Packing uses `--ignore-scripts`: without it, packing from inside `prepack`
// re-enters `prepack` forever.
//
// The scanner is the `contracts` binary from the pinned devDependency, not
// `bunx`. An unpinned package runner resolves to whatever is newest at publish
// time, so the gate's own behaviour is not reproducible — and a resolution
// failure silently becomes a non-run.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { runContracts } from "./contracts-cli.mjs";

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
const workspace = mkdtempSync(join(tmpdir(), "feedback-artifact-scan-"));

try {
  const packed = run(["bun", "pm", "pack", "--destination", workspace, "--ignore-scripts", "--quiet"], repoRoot);
  const archive = isAbsolute(packed) ? packed : join(workspace, packed);

  const status = runContracts(["artifact-scan", archive], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (status !== 0) {
    console.error("\nA published artifact must not carry a bulk asset inventory. See @hasna/contracts CONTRACT.md clause B.");
    process.exit(status);
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
