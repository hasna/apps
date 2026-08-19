import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(scriptsDir, "..");

interface ScanResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runScanner(cwd: string): ScanResult {
  const result = Bun.spawnSync([process.execPath, "scripts/scan-artifact.ts"], { cwd, stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

describe("scan-artifact release gate", () => {
  test("the packed artifact of the current package passes the gate", () => {
    const result = runScanner(packageRoot);
    expect(result.exitCode).toBe(0);
    expect(result.stderr, result.stderr).toBe("");
    expect(result.stdout).toContain("pass artifact-scan");
  });

  test("a package with a broken contract fails the gate with a non-zero exit", () => {
    const tmp = mkdtempSync(join(tmpdir(), "actions-scan-broken-"));
    try {
      // The scanner resolves paths from its own location, so the broken package is a
      // copy of the script plus a package.json and a malformed contract.
      mkdirSync(join(tmp, "scripts"));
      cpSync(join(packageRoot, "scripts", "scan-artifact.ts"), join(tmp, "scripts", "scan-artifact.ts"));
      cpSync(join(packageRoot, "package.json"), join(tmp, "package.json"));
      symlinkSync(join(packageRoot, "node_modules"), join(tmp, "node_modules"), "dir");
      writeFileSync(join(tmp, "hasna.contract.json"), "{ this is not valid JSON");

      const result = runScanner(tmp);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Could not read asset-inventory waivers from");
      expect(result.stderr).toContain("hasna.contract.json");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
