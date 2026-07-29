import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanPublishedArtifact } from "@hasna/contracts/artifact-scan";

const repoRoot = join(import.meta.dir, "..");

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

    const script = readFileSync(join(repoRoot, "scripts", "scan-artifact.ts"), "utf8");
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
    expect(stdout).toContain("artifact-scan");
  }, 120_000);

  test("the scan rejects an artifact carrying a bulk asset inventory", () => {
    const workspace = mkdtempSync(join(tmpdir(), "open-otp-artifact-gate-test-"));
    try {
      const packageDir = join(workspace, "package");
      const inventory = Array.from({ length: 40 }, (_value, index) => `tenant-${index}.example-inventory-${index}.com`);
      Bun.spawnSync(["mkdir", "-p", packageDir]);
      writeFileSync(join(packageDir, "index.js"), `export const hosts = ${JSON.stringify(inventory)};\n`);
      const archive = join(workspace, "inventory.tgz");
      const packed = Bun.spawnSync(["tar", "czf", archive, "-C", workspace, "package"]);
      expect(packed.exitCode).toBe(0);

      const report = scanPublishedArtifact(archive);
      expect(report.ok).toBe(false);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
