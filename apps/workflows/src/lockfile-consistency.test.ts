import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";

/**
 * Regression for O15-00767: per-app bun.lock drifted from package.json.
 *
 * This app ships a self-contained per-app bun.lock so the Dockerfile can run
 * `bun install --frozen-lockfile` with only package.json + bun.lock copied
 * into the image (deps stage) and `bun install --production --frozen-lockfile`
 * in the runner stage. When a manifest pin moves without regenerating the
 * lockfile, the frozen install fails:
 *
 *   error: lockfile had changes, but lockfile is frozen
 *
 * Measured 2026-08-27 at origin/main 55e34ace: apps/workflows/package.json
 * declares @hasna/contracts 0.14.1 (the O15-00731 repin wave) while
 * apps/workflows/bun.lock still resolves 0.14.0. Regenerating the lockfile
 * changes exactly that one package.
 *
 * This test asserts every dependency and devDependency declared in
 * package.json is declared with the identical version string in the
 * lockfile's root workspace block — a stale per-app lockfile fails here
 * before it can block the docker build.
 */
const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
/**
 * bun.lock v1 text format is JSONC: object/array members end with trailing
 * commas. Strip them (outside of string literals they only appear before a
 * closing bracket, and no value in this lockfile ends with a comma) so the
 * lockfile parses as plain JSON.
 */
function parseLockfile(raw: string): {
  workspaces: Record<
    string,
    { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
  >;
} {
  const stripped = raw.replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(stripped) as {
    workspaces: Record<
      string,
      { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    >;
  };
}

const lockfile = parseLockfile(readFileSync(join(appRoot, "bun.lock"), "utf8"));

const rootLock = lockfile.workspaces[""];
expect(rootLock, "bun.lock must carry the root workspace block").toBeDefined();

for (const section of ["dependencies", "devDependencies"] as const) {
  for (const [name, declared] of Object.entries(manifest[section] ?? {})) {
    test(`bun.lock matches package.json ${section}.${name}`, () => {
      const locked = rootLock[section]?.[name];
      expect(
        locked,
        `bun.lock ${section}.${name} missing — regenerate the per-app lockfile (bun install in apps/workflows)`,
      ).toBeDefined();
      expect(
        locked,
        `bun.lock ${section}.${name} stale: lockfile "${locked}" vs package.json "${declared}" — regenerate the per-app lockfile (bun install in apps/workflows)`,
      ).toBe(declared);
    });
  }
}
