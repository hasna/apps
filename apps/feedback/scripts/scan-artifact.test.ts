// Sol-guided coverage — Priority 5: the packed-artifact scan gate.
//
// Success arm: the REAL shipped gate (`scripts/scan-artifact.ts`) packs the
// package and scans the packed artifact; it must exit 0.
// Failure arm: the same `contracts artifact-scan` verb against a synthetic
// fixture carrying a bulk asset inventory must exit non-zero — the check that
// cannot fail is the exact defect this gate exists to prevent.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveContractsCli } from "./contracts-cli.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(scriptsDir);
const scanArtifact = join(scriptsDir, "scan-artifact.ts");

function contractsArtifactScan(target: string): { code: number; stdout: string; stderr: string } {
  const cli = resolveContractsCli();
  const result = Bun.spawnSync([process.execPath, cli, "artifact-scan", target], {
    cwd: packageRoot,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120000,
  });
  return {
    code: result.exitCode ?? -1,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

describe("scan-artifact gate", () => {
  test("success arm: the shipped scan script packs and scans the real artifact cleanly", () => {
    const result = Bun.spawnSync(["bun", "run", scanArtifact], {
      cwd: packageRoot,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 180000,
    });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
  });

  test("failure arm: a packed fixture with a bulk asset inventory fails the artifact scan", () => {
    const fixture = mkdtempSync(join(tmpdir(), "feedback-artifact-fixture-"));
    writeFileSync(join(fixture, "package.json"), JSON.stringify({ name: "@hasna/feedback-fixture", version: "0.0.0" }));
    // 30 distinct non-reserved email addresses cross the email threshold (15).
    const inventory = Array.from({ length: 30 }, (_, i) => `user-${i}@assetinventory.examplehost.com`).join("\n");
    writeFileSync(join(fixture, "bulk-inventory.txt"), `${inventory}\n`);

    const failing = contractsArtifactScan(fixture);
    expect(failing.code).not.toBe(0);

    // Same fixture minus the bulk inventory scans clean: the failure above is
    // attributable to the inventory, not to the fixture shape.
    const cleanFixture = mkdtempSync(join(tmpdir(), "feedback-artifact-clean-"));
    writeFileSync(join(cleanFixture, "package.json"), JSON.stringify({ name: "@hasna/feedback-clean", version: "0.0.0" }));
    writeFileSync(join(cleanFixture, "readme.txt"), "a plain single email: ops@examplehost.com is fine\n");
    const passing = contractsArtifactScan(cleanFixture);
    expect(passing.code, passing.stdout + passing.stderr).toBe(0);
  });
});
