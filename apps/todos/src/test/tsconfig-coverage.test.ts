/**
 * Guards the tsconfig split.
 *
 * `tsconfig.json` describes the BUILD surface (its `include` drives
 * `tsc --emitDeclarationOnly --outDir dist`, and package.json publishes `dist`).
 * `tsconfig.typecheck.json` is what CI actually runs, and additionally covers the
 * shared helpers under src/test/.
 *
 * TypeScript REPLACES `include` across `extends` rather than merging it, so the
 * typecheck config has to restate the build config's entries. That duplication is
 * silent: add an entry to tsconfig.json and typecheck simply stops covering it.
 * This test makes that drift loud.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");

/**
 * tsconfig files allow comments, which JSON.parse rejects, so they are stripped
 * LINE-WISE rather than by regex over the whole text. A naive
 * `/\/\*[\s\S]*?\*\//` block-comment strip silently eats the `/**​/` inside globs
 * like "src/sdk/**​/*.ts", rewriting them to "src/sdk*.ts" — which is exactly the
 * kind of quiet corruption this file exists to catch, so it must not commit it.
 * Only whole-line `//` comments are used in these two files.
 */
function readTsconfig(name: string): { include: string[]; exclude?: string[] } {
  const raw = readFileSync(join(REPO_ROOT, name), "utf-8");
  const withoutComments = raw
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
  return JSON.parse(withoutComments) as { include: string[]; exclude?: string[] };
}

describe("tsconfig build/typecheck split", () => {
  test("everything the build compiles is also typechecked", () => {
    const build = readTsconfig("tsconfig.json");
    const typecheck = readTsconfig("tsconfig.typecheck.json");

    const missing = build.include.filter((entry) => !typecheck.include.includes(entry));
    expect(missing).toEqual([]);
  });

  test("typecheck covers the shared test helpers, and the build does not", () => {
    const build = readTsconfig("tsconfig.json");
    const typecheck = readTsconfig("tsconfig.typecheck.json");

    // The whole point of the split: helpers are typechecked...
    expect(typecheck.include).toContain("src/test/**/*.ts");
    // ...but never emitted into dist, or they would be published.
    expect(build.include).not.toContain("src/test/**/*.ts");
  });
});
