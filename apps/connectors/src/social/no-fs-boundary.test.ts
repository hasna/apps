import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const socialDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(socialDir, "..", "..");
const socialEntry = join(socialDir, "index.ts");

/**
 * The whole point of @hasna/connectors/social is bundle-safety: it must execute a
 * social op purely from in-memory credentials, with NO transitive import of the
 * stateful runner / db / storage / fs / child_process. We prove it by bundling the
 * entry for `--target bun` and asserting the forbidden tokens are absent.
 */
describe("@hasna/connectors/social bundle-safety boundary", () => {
  test("social entry bundles for --target bun without fs/child_process/runner refs", () => {
    const outDir = mkdtempSync(join(tmpdir(), "social-bundle-"));
    const outFile = join(outDir, "social-bundle.js");
    try {
      const result = Bun.spawnSync(
        ["bun", "build", socialEntry, "--target", "bun", "--outfile", outFile],
        { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
      );
      expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);

      const bundle = readFileSync(outFile, "utf8");
      const forbidden = [
        "node:fs",
        "node:child_process",
        'require("fs")',
        "require('fs')",
        "child_process",
        "getConnectorsHome",
      ];
      const offenders = forbidden.filter((token) => bundle.includes(token));
      expect(offenders).toEqual([]);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 60_000);

  test("social source files do not statically import fs / db / runner / storage", () => {
    const sources = [
      "index.ts",
      "x.ts",
      "mastodon.ts",
      "bluesky.ts",
      "types.ts",
      "errors.ts",
      "util.ts",
    ].map((f) => join(socialDir, f));

    const forbiddenImports = [
      /from\s+["']node:fs["']/,
      /from\s+["']fs["']/,
      /from\s+["']node:child_process["']/,
      /from\s+["']child_process["']/,
      /from\s+["'][^"']*lib\/runner/,
      /from\s+["'][^"']*\/db\//,
      /from\s+["'][^"']*\/storage["']/,
      /from\s+["'][^"']*lib\/registry/,
    ];

    const offenders: string[] = [];
    for (const file of sources) {
      const content = readFileSync(file, "utf8");
      for (const pattern of forbiddenImports) {
        if (pattern.test(content)) offenders.push(`${file}:${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
