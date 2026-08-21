import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Regression lock for the release-gate finding of 2026-08-21: the packed
 * tarball of @hasna/files carried `https://${name}.hasna.xyz` inside
 * dist/cli/index.js and dist/mcp/index.js — an internal-infra domain leaked
 * into a public package because @hasna/contracts was resolved at the ancient
 * registry version 0.5.2 whose client transport hardcodes that default host.
 * The CI publish-guard scans tarball entry PATHS only, so content reached the
 * tarball. This test rebuilds the two bundles that ship in the tarball and
 * asserts the internal-infra patterns are absent from the CONTENT.
 */

const INTERNAL_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "hasna-xyz-domain", re: /[.]hasna[.]xyz/ },
  { name: "aws-arn", re: /arn[:]aws[:]/ },
  { name: "hasna-internal-org", re: /hasna[-]internal/ },
  { name: "internal-apps", re: /internal[-]apps/ },
  { name: "hasna-internal-scope", re: /@hasna[-]internal/ },
];

const ROOT = join(import.meta.dir, "..", "..");
let outDirs: string[] = [];

beforeEach(() => {
  outDirs = [mkdtempSync(join(tmpdir(), "files-bundle-guard-")), mkdtempSync(join(tmpdir(), "files-bundle-guard-"))];
});

afterEach(() => {
  for (const dir of outDirs) rmSync(dir, { recursive: true, force: true });
  outDirs = [];
});

function buildEntry(outDir: string, entry: string, args: string[]): void {
  const result = Bun.spawnSync({
    cmd: ["bun", "build", entry, "--outdir", outDir, "--target", "bun", ...args],
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
}

describe("published bundle content guard", () => {
  test("cli and mcp bundles carry no internal-infra strings", () => {
    const [cliOut, mcpOut] = outDirs;
    buildEntry(cliOut, "src/cli/index.tsx", [
      "--external", "ink",
      "--external", "react",
      "--external", "chalk",
      "--external", "@modelcontextprotocol/sdk",
      "--external", "@aws-sdk/*",
      "--external", "pg",
    ]);
    buildEntry(mcpOut, "src/mcp/index.ts", [
      "--external", "@modelcontextprotocol/sdk",
      "--external", "@aws-sdk/*",
      "--external", "pg",
    ]);

    for (const [label, outDir] of [["cli", cliOut], ["mcp", mcpOut]] as const) {
      const text = readFileSync(join(outDir, "index.js"), "utf8");
      for (const { name, re } of INTERNAL_PATTERNS) {
        const hit = re.exec(text);
        expect(hit, `${label} bundle matched ${name}: ${hit?.[0]}`).toBeNull();
      }
    }
  });
});
