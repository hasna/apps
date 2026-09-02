import { lstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatArtifactScanReport,
  resolveAssetInventoryWaivers,
  scanPublishedArtifact,
} from "@hasna/contracts/artifact-scan";

function run(command: string[], cwd: string): string {
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const stdout = new TextDecoder().decode(result.stdout).trim();
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`${command.join(" ")} exited ${result.exitCode}\n${stdout}\n${stderr}`);
  }
  return stdout;
}

export function assertSupportedNpmVersion(version: string): void {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match || match.slice(1).some((part) => !Number.isSafeInteger(Number(part)))) {
    throw new Error("artifact scan: could not determine a stable npm version; use npm >=11");
  }
  if (Number(match[1]) < 11) {
    throw new Error(`artifact scan: npm >=11 is required to suppress prepare during packing (found ${version})`);
  }
}

function requireSupportedNpm(cwd: string): void {
  let result: ReturnType<typeof Bun.spawnSync>;
  try {
    result = Bun.spawnSync(["npm", "--version"], { cwd, stdout: "pipe", stderr: "pipe" });
  } catch {
    throw new Error("artifact scan: npm version check unavailable; use npm >=11");
  }
  if (result.exitCode !== 0) {
    throw new Error("artifact scan: npm version check failed; use npm >=11");
  }
  // Do not include unvalidated tool output in diagnostics.
  assertSupportedNpmVersion(new TextDecoder().decode(result.stdout).trim());
}

export function packCommand(workspace: string): string[] {
  // prepack builds first. The inner pack must not recurse or inherit an outer
  // npm pack --dry-run, which exports npm_config_dry_run=true to lifecycle hooks.
  return ["npm", "pack", ".", "--json", "--ignore-scripts", "--workspaces=false",
    "--dry-run=false", "--pack-destination", workspace];
}

export function packedArchive(packed: string, workspace: string): string {
  let entries: unknown;
  try {
    entries = JSON.parse(packed);
  } catch {
    throw new Error("artifact scan: npm pack did not return valid JSON");
  }
  if (!Array.isArray(entries) || entries.length !== 1) {
    throw new Error("artifact scan: npm pack must return exactly one artifact");
  }
  const filename = entries[0]?.filename;
  // Accept only a basename in our private workspace: no path traversal, remote
  // path, option-shaped name, or unrelated workspace package can reach the scan.
  if (typeof filename !== "string" || !/^[a-z0-9][a-z0-9._-]*\.tgz$/i.test(filename)) {
    throw new Error("artifact scan: npm pack returned an invalid archive filename");
  }
  const archive = join(workspace, filename);
  let regular = false;
  try {
    regular = lstatSync(archive).isFile();
  } catch {
    // Missing files (including dry-run output) cannot be scanned.
  }
  if (!regular) throw new Error("artifact scan: npm pack did not create a local regular archive");
  return archive;
}

export function scanPackedArtifact() {
  const repoRoot = join(import.meta.dir, "..");
  // npm 10 can run prepare even with --ignore-scripts. Refuse it before pack.
  requireSupportedNpm(repoRoot);
  const workspace = mkdtempSync(join(tmpdir(), "slides-artifact-scan-"));
  try {
    const archive = packedArchive(run(packCommand(workspace), repoRoot), workspace);
    const waivers = resolveAssetInventoryWaivers(join(repoRoot, "hasna.contract.json"));
    const report = scanPublishedArtifact(archive, { waivedKinds: waivers.kinds });
    return { notes: waivers.notes, report };
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const { notes, report } = scanPackedArtifact();
  for (const note of notes) console.log(`waiver: ${note}`);
  console.log(formatArtifactScanReport(report));
  if (!report.ok) process.exitCode = 1;
}
