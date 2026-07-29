import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanPublishedArtifact } from "@hasna/contracts/artifact-scan";
import { GATE_FAILURE_MESSAGE, gateExitCode } from "../scripts/scan-artifact";

const repoRoot = join(import.meta.dir, "..");
const scanScript = join(repoRoot, "scripts", "scan-artifact.ts");

interface PackageManifest {
  scripts?: Record<string, string>;
}

function readScripts(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as PackageManifest;
  return pkg.scripts ?? {};
}

/** Script names a `bun run <name>` / `npm run <name>` body reaches, transitively. */
function scriptsReachedBy(scripts: Record<string, string>, entry: string): Set<string> {
  const reached = new Set<string>();
  const pending = [entry];

  while (pending.length > 0) {
    const name = pending.pop();
    if (name === undefined || reached.has(name)) continue;
    reached.add(name);
    const body = scripts[name];
    if (body === undefined) continue;
    for (const match of body.matchAll(/\b(?:bun|npm|pnpm|yarn)\s+run\s+([A-Za-z0-9:_-]+)/g)) {
      const next = match[1];
      if (next !== undefined) pending.push(next);
    }
  }

  return reached;
}

/** A tarball shaped like a published package whose only member holds an asset inventory. */
function packInventoryArchive(workspace: string): string {
  const packageDir = join(workspace, "package");
  const inventory = Array.from({ length: 40 }, (_value, index) => `tenant-${index}.example-inventory-${index}.com`);
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, "index.js"), `export const hosts = ${JSON.stringify(inventory)};\n`);
  const archive = join(workspace, "inventory.tgz");
  const packed = Bun.spawnSync(["tar", "czf", archive, "-C", workspace, "package"]);
  expect(packed.exitCode).toBe(0);
  return archive;
}

/** The same shape, carrying nothing an inventory scan objects to. */
function packCleanArchive(workspace: string): string {
  const packageDir = join(workspace, "package");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, "index.js"), "export const answer = 42;\n");
  const archive = join(workspace, "clean.tgz");
  const packed = Bun.spawnSync(["tar", "czf", archive, "-C", workspace, "package"]);
  expect(packed.exitCode).toBe(0);
  return archive;
}

async function runScanScript(args: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn({
    cmd: ["bun", scanScript, ...args],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("published artifact release gate", () => {
  test("prepack reaches the packed-artifact scan", () => {
    const scripts = readScripts();
    expect(scripts.prepack).toBeDefined();
    expect(scripts["scan:artifact"]).toBeDefined();
    expect(scriptsReachedBy(scripts, "prepack")).toContain("scan:artifact");
  });

  test("the scan pins the contract kit instead of resolving it at run time", () => {
    const scripts = readScripts();
    const body = scripts["scan:artifact"];
    expect(body).toBeDefined();
    // `npx @hasna/contracts` resolves a different release per machine — under a
    // minimum-release-age policy it silently lands on one without this command.
    expect(body).not.toMatch(/\b(?:npx|bunx)\b/);

    const script = readFileSync(scanScript, "utf8");
    const code = script
      .split("\n")
      .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
      .join("\n");
    expect(code).not.toMatch(/\b(?:npx|bunx)\b/);
    expect(code).toContain("@hasna/contracts/artifact-scan");
  });

  test("the scan script packs and scans this repo without error", async () => {
    const proc = Bun.spawn({
      cmd: ["bun", "run", "scan:artifact"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(stderr).not.toContain("unknown command");
    expect(stderr).not.toContain("missing required argument");
    expect(exitCode).toBe(0);
    // The tarball, not `src/`. A scan pointed at the source tree reports
    // `source_tree` and would clear files that never ship — and miss the ones
    // the bundler inlines, which is the whole reason this gate exists.
    expect(stdout).toMatch(/^pass artifact-scan \S+\.tgz \(packed_artifact, [1-9]\d* members scanned/m);
  }, 120_000);

  test("the gate exits non-zero on an artifact carrying a bulk asset inventory", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "open-otp-artifact-gate-test-"));
    try {
      const archive = packInventoryArchive(workspace);
      const { stdout, stderr, exitCode } = await runScanScript([archive]);

      expect(stdout).toContain("FAIL artifact-scan");
      expect(stderr).toContain(GATE_FAILURE_MESSAGE);
      // Fail closed: a gate that reports the finding and still exits 0 lets the
      // publish through, which is indistinguishable from having no gate.
      expect(exitCode).toBe(1);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }, 120_000);

  test("the gate exits zero on an artifact the scan clears", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "open-otp-artifact-gate-clean-"));
    try {
      const archive = packCleanArchive(workspace);
      const { stdout, exitCode } = await runScanScript([archive]);

      expect(stdout).toContain("pass artifact-scan");
      expect(exitCode).toBe(0);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }, 120_000);

  test("gateExitCode fails closed on a rejected report and passes a clean one", () => {
    const workspace = mkdtempSync(join(tmpdir(), "open-otp-artifact-gate-decision-"));
    try {
      const rejected = scanPublishedArtifact(packInventoryArchive(workspace));
      expect(rejected.ok).toBe(false);
      expect(gateExitCode(rejected)).toBe(1);

      const cleared = scanPublishedArtifact(packCleanArchive(workspace));
      expect(cleared.ok).toBe(true);
      expect(gateExitCode(cleared)).toBe(0);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
