// Clause C release gate: pack this repo the way `npm publish` would, then scan
// what actually shipped.
//
// The scan must run against the PACKED tarball, never `src/` — `files` means the
// repo and the package diverge, and the divergence is where a disclosure hides.
// `prepack` runs BEFORE any tarball exists, so this script produces its own:
// it packs to a temp directory with `--ignore-scripts`, which is also what keeps
// packing from inside `prepack` from re-entering `prepack` forever.
//
// The kit version is read from devDependencies rather than written here twice,
// so the gate and the installed kit cannot drift apart.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

const KIT_PACKAGE = "@hasna/contracts";

const repoRoot = join(import.meta.dir, "..");

function pinnedKitVersion(): string {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    devDependencies?: Record<string, string>;
  };
  const spec = pkg.devDependencies?.[KIT_PACKAGE];
  if (!spec) {
    throw new Error(`${KIT_PACKAGE} must be a devDependency so the release gate resolves a pinned kit`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(spec)) {
    throw new Error(`${KIT_PACKAGE} must be pinned to an exact version, got "${spec}"`);
  }
  return spec;
}

function run(command: string[], cwd: string): string {
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const stdout = new TextDecoder().decode(result.stdout).trim();
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`${command.join(" ")} exited ${result.exitCode}\n${stdout}\n${stderr}`);
  }
  return stdout;
}

// Invoke the kit through its package bin, never a file inside its `dist/`. The
// lockfile-resolved local bin is preferred over `bunx`: it is the strongest
// pin available and it does not need the registry at publish time.
function kitCommand(version: string): string[] {
  const localBin = join(repoRoot, "node_modules", ".bin", "contracts");
  if (existsSync(localBin)) return [localBin];
  return ["bunx", `${KIT_PACKAGE}@${version}`];
}

const version = pinnedKitVersion();
const workspace = mkdtempSync(join(tmpdir(), "signatures-artifact-scan-"));

try {
  const packed = run(["bun", "pm", "pack", "--destination", workspace, "--ignore-scripts", "--quiet"], repoRoot);
  const archive = isAbsolute(packed) ? packed : join(workspace, packed);

  const scan = Bun.spawnSync([...kitCommand(version), "artifact-scan", archive], {
    cwd: repoRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (scan.exitCode !== 0) {
    console.error(`\nPacked-artifact scan failed for ${archive}. See @hasna/contracts CONTRACT.md clause B.`);
    process.exit(scan.exitCode ?? 1);
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
