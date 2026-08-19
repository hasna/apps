// Pack this repo the way `npm publish` would, then scan what actually shipped.
//
// It scans the TARBALL, never `src/`. Running the scanner against the working
// directory would report on files that may never be published and would miss
// built output that is — so a source-directory scan is a gate that cannot fail
// for the case it exists to catch.
//
// Packing uses `--ignore-scripts`: without it, packing from inside `prepack`
// re-enters `prepack` forever.
//
// The scanner is the `contracts` binary from the pinned devDependency, not
// `bunx`. An unpinned package runner resolves to whatever is newest at publish
// time, and a resolution failure silently becomes a non-run.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function run(command: string[], cwd: string): string {
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const stdout = new TextDecoder().decode(result.stdout).trim();
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`${command.join(" ")} exited ${result.exitCode}\n${stdout}\n${stderr}`);
  }
  return stdout;
}

export function resolveContractsCli(): string {
  const packageJsonPath = fileURLToPath(import.meta.resolve("@hasna/contracts/package.json"));
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const bin = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.contracts;
  if (!bin) {
    throw new Error("@hasna/contracts does not declare the contracts CLI");
  }
  return resolve(dirname(packageJsonPath), bin);
}

export function scanArtifact(): void {
  const repoRoot = join(import.meta.dir, "..");
  const workspace = mkdtempSync(join(tmpdir(), "models-artifact-scan-"));

  try {
    const packed = run(["bun", "pm", "pack", "--destination", workspace, "--ignore-scripts", "--quiet"], repoRoot);
    const archive = isAbsolute(packed) ? packed : join(workspace, packed);

    const scanner = resolveContractsCli();
    const result = Bun.spawnSync([process.execPath, scanner, "artifact-scan", archive], {
      cwd: repoRoot,
      stdout: "inherit",
      stderr: "inherit",
    });
    if (result.exitCode !== 0) {
      console.error("\nA published artifact must not carry a bulk asset inventory. See @hasna/contracts CONTRACT.md clause B.");
      process.exit(result.exitCode ?? 1);
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  scanArtifact();
}
