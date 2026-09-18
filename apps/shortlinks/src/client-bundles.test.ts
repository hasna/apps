/**
 * Artifact ratchet for the three hosted client surfaces.
 *
 * The CLI, MCP server, and `./sdk` entry artifacts must never statically link
 * `bun:sqlite`. Local SQLite remains supported, but only behind the explicit
 * opt-in and its split runtime chunk. The positive counter-control prevents a
 * vacuous pass caused by deleting the local implementation.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PACKAGE_ROOT = resolve(import.meta.dir, "..");
const EXTERNALS = ["@modelcontextprotocol/sdk", "pg"];

function runBuild(args: string[], cwd = PACKAGE_ROOT): void {
  const result = Bun.spawnSync([process.execPath, "build", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
}

describe("published client artifacts isolate SQLite", () => {
  test("CLI, MCP, and SDK entries contain zero bun:sqlite references", () => {
    const outDir = mkdtempSync(join(tmpdir(), "shortlinks-client-artifacts-"));
    try {
      runBuild([
        "src/cli/index.ts",
        "src/mcp/index.ts",
        "src/sdk/index.ts",
        "--root", "src",
        "--outdir", outDir,
        "--target", "bun",
        "--splitting",
        "--chunk-naming", "chunks/[name]-[hash].[ext]",
        ...EXTERNALS.flatMap((dependency) => ["--external", dependency]),
      ]);

      for (const relativePath of ["cli/index.js", "mcp/index.js", "sdk/index.js"]) {
        const artifact = readFileSync(join(outDir, relativePath), "utf8");
        expect({ relativePath, sqliteReferences: artifact.match(/bun:sqlite/g)?.length ?? 0 }).toEqual({
          relativePath,
          sqliteReferences: 0,
        });
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 60_000);

  test("the explicit local-store artifact still contains the SQLite engine", () => {
    const outDir = mkdtempSync(join(tmpdir(), "shortlinks-local-artifact-"));
    try {
      runBuild([
        "src/local-store.ts",
        "--outdir", outDir,
        "--target", "bun",
        ...EXTERNALS.flatMap((dependency) => ["--external", dependency]),
      ]);
      const artifact = readFileSync(join(outDir, "local-store.js"), "utf8");
      expect(artifact.includes("bun:sqlite")).toBe(true);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 60_000);

  test("the package build keeps splitting enabled for the published client entries", () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
      scripts: { build: string };
    };
    expect(pkg.scripts.build).toContain("src/cli/index.ts");
    expect(pkg.scripts.build).toContain("src/mcp/index.ts");
    expect(pkg.scripts.build).toContain("src/sdk/index.ts");
    expect(pkg.scripts.build).toContain("--splitting");
    expect(pkg.scripts.build).toContain("--chunk-naming 'chunks/[name]-[hash].[ext]'");
  });
});
