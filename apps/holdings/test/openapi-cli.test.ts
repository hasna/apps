// Coverage lane (tests-coverage-sol workflow, Sol advisory Priority 5): the
// `holdings openapi generate|check` CLI operations had no tests at origin/main —
// openapi-contract.test.ts only compares the checked-in document in-process.
// These tests invoke the REAL CLI as a subprocess against temp files: generate
// writes a current document, check passes on it (exit 0) and fails non-zero on a
// one-field-stale document, and package.json exposes both operations as scripts.
import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openApiDocumentJson } from "../src/api/index.js";

const packageRoot = resolve(import.meta.dir, "..");
const cliEntry = "src/cli/index.tsx";

function runCli(args: string[]) {
  const result = Bun.spawnSync(["bun", "run", cliEntry, ...args], {
    cwd: packageRoot,
    env: process.env,
  });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

describe("openapi CLI operations against temp files", () => {
  it("generate writes a current document that check accepts (exit 0)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "holdings-oas-"));
    try {
      const out = join(tmp, "openapi.json");

      const generated = runCli(["openapi", "generate", "--out", out]);
      expect(generated.exitCode).toBe(0);
      expect(existsSync(out)).toBe(true);
      expect(readFileSync(out, "utf8").trim()).toBe(openApiDocumentJson().trim());

      const checked = runCli(["openapi", "check", "--path", out]);
      expect(checked.exitCode).toBe(0);
      expect(checked.stdout).toContain("is current");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("check fails NON-ZERO on a one-field-stale document and names the remedy", () => {
    const tmp = mkdtempSync(join(tmpdir(), "holdings-oas-"));
    try {
      const out = join(tmp, "stale.json");
      const stale = JSON.parse(openApiDocumentJson()) as Record<string, unknown>;
      stale["version"] = "0.0.0-stale";
      writeFileSync(out, `${JSON.stringify(stale, null, 2)}\n`);

      const checked = runCli(["openapi", "check", "--path", out]);
      expect(checked.exitCode).not.toBe(0);
      expect(checked.stderr).toContain("out of date");
      expect(checked.stderr).toContain("openapi generate");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("package scripts expose both openapi operations", () => {
  it("package.json declares openapi:generate and openapi:check", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(typeof pkg.scripts["openapi:generate"]).toBe("string");
    expect(pkg.scripts["openapi:generate"]).toContain("openapi");
    expect(pkg.scripts["openapi:generate"]).toContain("generate");
    expect(typeof pkg.scripts["openapi:check"]).toBe("string");
    expect(pkg.scripts["openapi:check"]).toContain("openapi");
    expect(pkg.scripts["openapi:check"]).toContain("check");
  });
});
