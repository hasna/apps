import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression guard for the `no_cloud_guard` contract rule.
 *
 * `@hasna/cloud` is retired and unsupported (owner ruling 2026-07-26): the
 * source repository is deleted and will not be restored, so any dependency on
 * it is a broken build waiting to happen as well as a contract breach. It was
 * previously wired into the core DB layer (`src/db/database.ts`), which is
 * reached by the CLI, the MCP server and the REST server alike.
 *
 * The scan covers everything this package SHIPS, not just `src/`. A bundled
 * `dist/` carries whatever its inputs imported even when the tracked source
 * looks clean, and `dist/` is the only thing npm consumers ever execute.
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
 * Roots to scan: everything `package.json` ships, plus the source tree that
 * produces it. Driven off `files` so that adding a shipped directory extends
 * this guard automatically instead of silently escaping it. `dist/` is absent
 * from a fresh checkout, so it is filtered out rather than asserted on — the
 * build step is what puts it in scope.
 */
function scanRoots(): string[] {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { files?: string[] };
  const roots = new Set<string>([...(pkg.files ?? []), "src"]);
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
    const manifests = [join(repoRoot, "package.json"), ...collect((name) => name === "package.json")];

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

  test("no shipped source file imports the retired package", () => {
    const offenders = collect((name) => SOURCE_EXTENSIONS.test(name))
      .filter((file) => FORBIDDEN_IMPORT.test(readFileSync(file, "utf8")))
      .map((file) => relative(repoRoot, file));

    expect(offenders).toEqual([]);
  });

  test("no built bundle carries the retired package", () => {
    // Bundlers inline dependency source under a `// node_modules/<pkg>/...`
    // banner, so the specifier regex above does not see it. Any mention at all
    // inside a build artifact means the dependency shipped.
    const offenders = collect((name) => SOURCE_EXTENSIONS.test(name))
      .filter((file) => relative(repoRoot, file).startsWith("dist/"))
      .filter((file) => readFileSync(file, "utf8").includes(FORBIDDEN_PACKAGE))
      .map((file) => relative(repoRoot, file));

    expect(offenders).toEqual([]);
  });

  test("the lockfile does not resolve the retired package", () => {
    const lockfile = join(repoRoot, "bun.lock");
    if (!existsSync(lockfile)) return;

    expect(readFileSync(lockfile, "utf8")).not.toContain(FORBIDDEN_PACKAGE);
  });

  test("the DB layer owns its own SQLite connection", () => {
    const database = readFileSync(join(repoRoot, "src/db/database.ts"), "utf8");

    // The retired adapter was a thin wrapper over bun:sqlite that applied these
    // two PRAGMAs; `foreign_keys` is per-connection, so losing it silently stops
    // ON DELETE CASCADE from firing.
    expect(database).toContain('from "bun:sqlite"');
    expect(database).toMatch(/PRAGMA journal_mode = WAL/);
    expect(database).toMatch(/PRAGMA foreign_keys = ON/);
  });
});
