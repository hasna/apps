import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression guard for the `no_cloud_guard` contract rule.
 *
 * `@hasna/cloud` is retired and unsupported (owner ruling 2026-07-26): the repo
 * is deleted and will not be restored, so any dependency on it is a broken
 * build waiting to happen as well as a contract breach. It was previously wired
 * into the core DB layer, the MCP server, and the CLI `cloud` command group.
 *
 * The scan covers everything this package SHIPS, not just `src/`. The vendored
 * `connectors/` tree is published to every machine in the fleet, so a connector
 * reintroducing the package there is just as live a breach as one in `src/`,
 * and far easier to miss.
 */
const FORBIDDEN_PACKAGE = "@hasna/cloud";

/**
 * The shipped tree includes the bundled output in `bin/` and `dist/`
 * alongside the vendored `connectors/` tree, so a full sweep
 * covers ~14.5k files and ~71MB. Every specifier the regex can match contains
 * the package name verbatim, so searching the raw bytes first is an exact
 * prefilter rather than an approximation: only files that mention the package
 * at all need decoding. Measured warm, that halves the sweep (~250ms against
 * ~300-380ms); the point is to stop paying to decode 71MB of mostly generated
 * bundles on a run where the answer is almost always "no match anywhere".
 */
const FORBIDDEN_PACKAGE_BYTES = Buffer.from(FORBIDDEN_PACKAGE);

function mentionsForbiddenPackage(file: string): boolean {
  return readFileSync(file).includes(FORBIDDEN_PACKAGE_BYTES);
}

/**
 * A whole-tree filesystem sweep is not a unit test's worth of work, and its
 * cost is dominated by how much of that 71MB is still in the page cache. Warm
 * and idle it lands around 250ms, but inside a full-suite run on a constrained
 * runner it was observed at 7169ms — over the 5s default, which is how this
 * file started failing CI intermittently. Budget it explicitly so a cold cache
 * or a busy runner reports a real breach instead of a timeout.
 */
const TREE_SWEEP_TIMEOUT_MS = 60_000;

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
 * Roots to scan: everything `package.json` ships, plus the source and tooling
 * trees that produce it. Driven off `files` so that adding a shipped directory
 * extends this guard automatically instead of silently escaping it.
 */
function scanRoots(): string[] {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { files?: string[] };
  const roots = new Set<string>([...(pkg.files ?? []), "src", "scripts", "sdk"]);
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
  }, TREE_SWEEP_TIMEOUT_MS);

  test("no shipped source file imports the retired package", () => {
    const offenders = collect((name) => SOURCE_EXTENSIONS.test(name))
      .filter(mentionsForbiddenPackage)
      .filter((file) => FORBIDDEN_IMPORT.test(readFileSync(file, "utf8")))
      .map((file) => relative(repoRoot, file));

    expect(offenders).toEqual([]);
  }, TREE_SWEEP_TIMEOUT_MS);

  test("the lockfile does not resolve the retired package", () => {
    const lockfile = join(repoRoot, "bun.lock");
    if (!existsSync(lockfile)) return;

    expect(readFileSync(lockfile, "utf8")).not.toContain(FORBIDDEN_PACKAGE);
  });

  test("the CLI and MCP server register no cloud surface", () => {
    const forbiddenSymbols = ["registerCloudTools", "registerCloudCommands", "PgAdapter", "incrementalSync"];
    const checkedFiles = ["src/cli/index.tsx", "src/mcp/server.ts"];

    const offenders = checkedFiles.flatMap((file) => {
      const content = readFileSync(join(repoRoot, file), "utf8");
      return forbiddenSymbols.filter((symbol) => content.includes(symbol)).map((symbol) => `${file}:${symbol}`);
    });

    expect(offenders).toEqual([]);
  });
});
