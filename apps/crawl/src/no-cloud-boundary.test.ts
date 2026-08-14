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
 * Every delimiter a module specifier can legally use. Backticks count:
 * `import(`pkg`)` is a valid dynamic import, so a quote class of `["']` alone
 * leaves an evasion route open.
 */
const QUOTE = "[\"'`]";
const NOT_QUOTE = "[^\"'`]";

/**
 * Matches the package as a module specifier in every import form —
 * `from "x"`, `import "x"`, `import("x")`, `require("x")` — including deep
 * imports like `x/dist/adapter.js`. Matching specifiers rather than bare
 * mentions means prose explaining the removal does not trip the guard.
 *
 * The whitespace between the keyword and the specifier is optional (`\s*`, not
 * `\s+`): `import"pkg";` with no space is valid JS and must not slip through.
 */
const FORBIDDEN_IMPORT = new RegExp(
  String.raw`(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)` +
    `${QUOTE}${FORBIDDEN_PACKAGE}(?:/${NOT_QUOTE}*)?${QUOTE}`,
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
 * `dist/` is gitignored and `bun test` does not build, so the built-output
 * check has nothing to inspect on a fresh checkout. It is gated on this flag
 * rather than filtering to an empty list, so an unbuilt tree reports the check
 * as SKIPPED instead of reporting a green "no built bundle carries the retired
 * package" over zero files.
 */
const distDir = join(repoRoot, "dist");
const hasBuiltOutput = existsSync(distDir) && statSync(distDir).isDirectory();
const isCi = Boolean(process.env["CI"]);

/**
 * Roots to scan: everything `package.json` ships, plus the source tree that
 * produces it. Driven off `files` so that adding a shipped directory extends
 * this guard automatically instead of silently escaping it. `dist/` is absent
 * from a fresh checkout, so it drops out here — the built-output check below
 * gates on it explicitly instead of quietly scanning nothing.
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

  test.if(hasBuiltOutput)("no built bundle carries the retired package", () => {
    // EVERY file under dist/, not only the source extensions: declaration maps
    // and any other emitted artifact ship to consumers too, and a specifier
    // planted in a `.map` is invisible to both the regex above and to
    // `contracts no-cloud-scan` in directory mode (dist/ is gitignored).
    //
    // Bundlers inline dependency source under a `// node_modules/<pkg>/...`
    // banner, so the specifier regex does not see that either. Any mention at
    // all inside a build artifact means the dependency shipped.
    const built = walk(distDir, () => true, []);

    // Guards the guard: an empty dist/ must not read as a clean dist/.
    expect(built.length).toBeGreaterThan(0);

    const offenders = built
      .filter((file) => readFileSync(file, "utf8").includes(FORBIDDEN_PACKAGE))
      .map((file) => relative(repoRoot, file));

    expect(offenders).toEqual([]);
  });

  // Locally the built-output check is allowed to skip; in CI, where the build
  // runs before the tests, a missing dist/ means the check silently stopped
  // covering the artifact consumers execute — so there it is a failure.
  test.if(isCi)("built output is present when CI runs the guard", () => {
    expect(hasBuiltOutput).toBe(true);
  });

  test("the lockfile does not resolve the retired package", () => {
    const lockfile = join(repoRoot, "bun.lock");

    // The lockfile is tracked, so its absence is a broken checkout, not a
    // reason to pass.
    expect(existsSync(lockfile)).toBe(true);
    expect(readFileSync(lockfile, "utf8")).not.toContain(FORBIDDEN_PACKAGE);
  });

  test("the DB layer owns its own SQLite connection", () => {
    const database = readFileSync(join(repoRoot, "src/db/database.ts"), "utf8");

    // The retired adapter was a thin wrapper over bun:sqlite that applied these
    // two PRAGMAs; `foreign_keys` is per-connection, so losing it silently stops
    // ON DELETE CASCADE from firing.
    //
    // Anchored to a live statement at the start of a line: a plain substring
    // match is satisfied by a commented-out PRAGMA, which enforces nothing.
    // (Cascade itself is covered behaviourally by src/db/pages.test.ts.)
    const liveStatement = (source: string) =>
      new RegExp(String.raw`^[ \t]*[\w$.]+\.exec\(\s*${QUOTE}${source}${QUOTE}`, "m");

    expect(database).toMatch(
      new RegExp(String.raw`^import\s+\{[^}]*\bDatabase\b[^}]*\}\s+from\s*${QUOTE}bun:sqlite${QUOTE}`, "m"),
    );
    expect(database).toMatch(liveStatement("PRAGMA journal_mode = WAL"));
    expect(database).toMatch(liveStatement("PRAGMA foreign_keys = ON"));
  });
});
