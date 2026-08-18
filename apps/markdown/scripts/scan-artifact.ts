// Pack this repo the way `npm publish` would, then scan what actually shipped.
//
// This is the published_artifact_gate (R5) scan of the PACKED artifact, dogfooding
// the `contracts artifact-scan` verb the contract kit ships. It packs to a temp
// directory with `--ignore-scripts` — without that, packing from inside `prepack`
// would re-enter `prepack` forever.
//
// It scans the TARBALL, never `src/`. The disclosure this exists to prevent was
// invisible from the repo: a file holding an asset inventory excluded by `files`
// while the built output carrying the same data was not.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

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
const workspace = mkdtempSync(join(tmpdir(), "markdown-artifact-scan-"));

try {
  const packed = run(
    ["bun", "pm", "pack", "--destination", workspace, "--ignore-scripts", "--quiet"],
    repoRoot,
  );
  const archive = isAbsolute(packed) ? packed : join(workspace, packed);
  // The manifest is where a reviewed, time-boxed waiver is declared, so the gate
  // reads ./hasna.contract.json from the repo root by default.
  run(["contracts", "artifact-scan", archive], repoRoot);
  console.log(`scan:artifact PASS — ${archive}`);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
