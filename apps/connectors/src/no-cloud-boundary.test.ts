import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression guard for the `no_cloud_guard` contract rule.
 *
 * `@hasna/cloud` is retired and unsupported (owner ruling 2026-07-26): the
 * repo is deleted and will not be restored, so any dependency on it is a
 * broken build waiting to happen as well as a contract breach. It was
 * previously wired into the core DB layer, the MCP server, and the CLI
 * `cloud` command group; this suite fails if any of that comes back.
 *
 * The scan matches module specifiers rather than bare mentions, so prose that
 * explains why the package is gone does not trip it.
 */
const FORBIDDEN_PACKAGE = "@hasna/cloud";

/** Matches `from "<pkg>"`, `import("<pkg>")` and `require("<pkg>")`, plus deep imports. */
const FORBIDDEN_IMPORT = new RegExp(
  String.raw`(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']${FORBIDDEN_PACKAGE}(?:/[^"']*)?["']`,
);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const selfPath = fileURLToPath(import.meta.url);

const SKIP_DIRS = new Set(["node_modules", "dist", "bin", ".git"]);
const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(fullPath));
    } else if (SOURCE_EXTENSIONS.test(entry.name) && fullPath !== selfPath) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("no_cloud_guard boundary", () => {
  test("package.json declares no dependency on the retired cloud package", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as Record<
      string,
      Record<string, string> | undefined
    >;
    const sections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
    const offenders = sections.filter((section) => pkg[section]?.[FORBIDDEN_PACKAGE] !== undefined);

    expect(offenders).toEqual([]);
  });

  test("no source file imports the retired cloud package", () => {
    const offenders = sourceFiles(join(repoRoot, "src"))
      .filter((file) => FORBIDDEN_IMPORT.test(readFileSync(file, "utf8")))
      .map((file) => relative(repoRoot, file));

    expect(offenders).toEqual([]);
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
