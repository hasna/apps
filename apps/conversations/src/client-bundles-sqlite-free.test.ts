// Every shipped client surface is API-only: the CLI, MCP, hook and library
// bundles must not contain the on-box SQLite store or import `bun:sqlite`.
// Ruling (d)/(e) of the fleet alignment (reports/T6-conversations.md, G4):
// a client bundle that still carries `LocalStore` can silently open a station
// database; this test fails the build the moment one path back appears.
//
// The server bundle (`conversations-serve`) is Postgres-only as well, but its
// entry is asserted separately in serve-entry.test.ts; the test-only
// `src/lib/store/local-store.ts` is the positive control that proves the
// scanner sees `bun:sqlite` when it is there.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import packageJson from "../package.json";

const root = join(import.meta.dir, "..");
const outDirs: string[] = [];

afterEach(() => {
  for (const dir of outDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const CLIENT_ENTRIES: Array<{ entry: string; externals: string[] }> = [
  { entry: "./src/cli/index.tsx", externals: ["ink", "react", "chalk"] },
  { entry: "./src/mcp/index.ts", externals: [] },
  { entry: "./src/hooks/blocker-hook.ts", externals: [] },
  { entry: "./src/index.ts", externals: [] },
  { entry: "./src/sdk/index.ts", externals: [] },
];

function build(entry: string, externals: string[]): string {
  const outDir = mkdtempSync(join(tmpdir(), "conversations-client-bundle-"));
  outDirs.push(outDir);
  const args = ["bun", "build", entry, "--target", "bun", "--outdir", outDir];
  for (const ext of externals) args.push("--external", ext);
  const built = Bun.spawnSync(args, { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect(built.stderr.toString() + built.stdout.toString()).not.toContain("error:");
  expect(built.exitCode).toBe(0);
  return readFileSync(join(outDir, basename(entry).replace(/\.tsx?$/, ".js")), "utf8");
}

describe("client bundles are SQLite-free", () => {
  for (const { entry, externals } of CLIENT_ENTRIES) {
    test(`${entry} bundles without bun:sqlite or LocalStore`, () => {
      const code = build(entry, externals);
      expect(code).not.toContain("bun:sqlite");
      expect(code).not.toMatch(/\bclass LocalStore\b/);
      expect(code).not.toContain("local-read-worker");
      // The local-store selectors are rejected, never advertised.
      expect(code).not.toMatch(/local mode is opt-in/i);
    });
  }

  test("the build script ships no local-read worker and every bin is declared", () => {
    expect(packageJson.scripts.build).not.toContain("local-read-worker");
    expect(Object.keys(packageJson.bin).sort()).toEqual([
      "conversations",
      "conversations-hook",
      "conversations-inbox",
      "conversations-mcp",
      "conversations-serve",
    ]);
    expect((packageJson.scripts as Record<string, string>).postinstall).toBeUndefined();
    expect(packageJson.files).not.toContain("postinstall.js");
  });

  test("positive control: the test-only LocalStore module does import bun:sqlite", () => {
    const code = build("./src/lib/store/local-store.ts", []);
    expect(code).toContain("bun:sqlite");
    expect(code).toMatch(/\bclass LocalStore\b/);
  });
});
