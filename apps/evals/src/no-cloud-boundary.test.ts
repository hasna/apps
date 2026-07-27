import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression guard for the `no_cloud_guard` contract rule.
 *
 * The retired shared-cloud runtime package is unsupported (owner ruling
 * 2026-07-26): its repo is deleted and will not be restored, so depending on it
 * is a broken build waiting to happen as well as a contract breach. It was
 * previously wired into the CLI `sync` command group, which pushed the local
 * SQLite eval store into a shared Postgres. That whole pattern is retired — the
 * store in `src/db/store.ts` owns its own `bun:sqlite` connection and there is
 * no replacement package to swap in.
 *
 * The scan covers everything this package SHIPS, not just `src/`. `dist/` is
 * what installs actually execute, and a compiled artifact has carried a
 * dependency its source no longer mentioned before, so built output is checked
 * whenever it is present.
 */
const FORBIDDEN_PACKAGE = "@hasna/cloud";

/**
 * Matches the package as a module specifier in every import form —
 * `from "x"`, `import "x"`, `import("x")`, `require("x")` — including deep
 * imports like `x/dist/adapter.js`. Matching specifiers rather than bare
 * mentions means prose explaining the removal does not trip the guard.
 */
const FORBIDDEN_IMPORT = new RegExp(
  String.raw`(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)` +
    String.raw`["']${FORBIDDEN_PACKAGE}(?:/[^"']*)?["']`,
);

/** Every package.json field that can pull a package into an install. */
const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "bundleDependencies",
  "bundledDependencies",
  "overrides",
  "resolutions",
  "trustedDependencies",
];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const selfPath = fileURLToPath(import.meta.url);

/** Only ever skipped: never our own code, and enormous. */
const SKIP_DIRS = new Set(["node_modules", ".git"]);
const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

/**
 * Roots to scan: everything `package.json` ships, plus the source trees that
 * produce it. Driven off `files` so that adding a shipped directory extends
 * this guard automatically instead of silently escaping it.
 */
function scanRoots(): string[] {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { files?: string[] };
  const roots = new Set<string>([...(pkg.files ?? []), "src", "scripts", "dashboard/src"]);
  return [...roots]
    .map((entry) => join(repoRoot, entry.replace(/\/+$/, "")))
    .filter((path) => existsSync(path) && statSync(path).isDirectory());
}

function walk(dir: string, match: (name: string) => boolean, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, match, out);
    } else if (match(entry.name) && fullPath !== selfPath) {
      out.push(fullPath);
    }
  }
  return out;
}

function collect(match: (name: string) => boolean): string[] {
  const seen = new Set<string>();
  for (const root of scanRoots()) {
    for (const file of walk(root, match, [])) seen.add(file);
  }
  return [...seen];
}

describe("no_cloud_guard boundary", () => {
  test("no package.json in the shipped tree depends on the retired package", () => {
    const manifests = [
      join(repoRoot, "package.json"),
      join(repoRoot, "dashboard", "package.json"),
      ...collect((name) => name === "package.json"),
    ].filter((file) => existsSync(file));

    const offenders = manifests.flatMap((file) => {
      const pkg = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      return DEPENDENCY_SECTIONS.filter((section) => {
        const value = pkg[section];
        // Most sections are objects keyed by package name; bundleDependencies is an array.
        if (Array.isArray(value)) return value.includes(FORBIDDEN_PACKAGE);
        return typeof value === "object" && value !== null && FORBIDDEN_PACKAGE in value;
      }).map((section) => `${relative(repoRoot, file)}:${section}`);
    });

    expect(offenders).toEqual([]);
  });

  test("no shipped source or built file imports the retired package", () => {
    const offenders = collect((name) => SOURCE_EXTENSIONS.test(name))
      .filter((file) => FORBIDDEN_IMPORT.test(readFileSync(file, "utf8")))
      .map((file) => relative(repoRoot, file));

    expect(offenders).toEqual([]);
  });

  /**
   * Built output is bundled, so a dependency can survive there as inlined code with
   * no import specifier left to match — which is exactly how a previous package
   * shipped a reference its source no longer had. Built artifacts carry no prose, so
   * they get the strictest check available: the name must not appear at all.
   */
  test("built output contains no trace of the retired package", () => {
    const distRoots = ["dist", "dashboard/dist"]
      .map((entry) => join(repoRoot, entry))
      .filter((path) => existsSync(path) && statSync(path).isDirectory());
    if (distRoots.length === 0) return; // Not built yet; `bun run build` re-arms this.

    const offenders = distRoots
      .flatMap((root) => walk(root, () => true, []))
      .filter((file) => readFileSync(file, "utf8").includes(FORBIDDEN_PACKAGE))
      .map((file) => relative(repoRoot, file));

    expect(offenders).toEqual([]);
  });

  test("the lockfile does not resolve the retired package", () => {
    const lockfile = ["bun.lock", "bun.lockb", "package-lock.json"]
      .map((name) => join(repoRoot, name))
      .find((path) => existsSync(path));
    if (!lockfile) return;

    expect(readFileSync(lockfile, "utf8")).not.toContain(FORBIDDEN_PACKAGE);
  });

  test("the CLI and MCP server register no cloud sync surface", () => {
    const forbiddenSymbols = [
      "syncCommand",
      "syncPush",
      "syncPull",
      "PgAdapter",
      "getCloudConfig",
      "registerCloudCommands",
      "registerCloudTools",
    ];
    const checkedFiles = ["src/cli/index.ts", "src/mcp/server.ts", "src/index.ts"];

    const offenders = checkedFiles.flatMap((file) => {
      const content = readFileSync(join(repoRoot, file), "utf8");
      return forbiddenSymbols.filter((symbol) => content.includes(symbol)).map((symbol) => `${file}:${symbol}`);
    });

    expect(offenders).toEqual([]);
  });
});
