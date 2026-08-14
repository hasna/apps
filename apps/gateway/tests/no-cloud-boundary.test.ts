import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { relative } from "node:path";

/**
 * The retired shared cloud runtime, assembled at runtime rather than written as one
 * literal. A byte-level scanner cannot tell a guard assertion apart from a real import,
 * so spelling the name out here would make this very file look like the breach it exists
 * to prevent.
 *
 * The same property is this guard's one blind spot: it matches literal occurrences only,
 * so a specifier assembled at runtime — exactly the construction two lines below — is
 * invisible to it, as it is to every byte-level scanner. That is accepted rather than
 * fixed: resolving computed specifiers needs a type-aware pass, and the failure mode this
 * guard exists to catch is an ordinary `import`, a manifest entry or a bundled copy.
 */
const retiredRuntime = ["@hasna", "cloud"].join("/");
const retiredRepo = ["open", "cloud"].join("-");

/**
 * This file is the one tracked file allowed to reference the retired names, because the
 * assertions below have to name what they forbid. Excluded by path so the exclusion cannot
 * silently widen.
 */
const guardFile = "tests/no-cloud-boundary.test.ts";

/**
 * `@hasna/contracts` is a direct dependency and `bun build` inlines it into `dist`, which
 * carries its denylist constant — a literal array of the very names this guard forbids —
 * into our build output. That single declaration is the only occurrence permitted in built
 * output; anything else is a real bundled edge and fails.
 */
const vendoredDenylistDeclaration = "FORBIDDEN_SHARED_CLOUD_RUNTIMES";

const repoRoot = new URL("../", import.meta.url).pathname;
const distRoot = new URL("../dist/", import.meta.url).pathname;

const manifest = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

/**
 * Every file git tracks, not just `src/`. Scanning `src/` alone left scripts, tests,
 * config, docs and the workflow files free to import the retired runtime.
 */
function trackedFiles(): string[] {
  const listed = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: repoRoot });
  if (listed.exitCode !== 0) {
    throw new Error(`git ls-files failed (exit ${listed.exitCode}); refusing to scan an unknown file set`);
  }
  return new TextDecoder()
    .decode(listed.stdout)
    .split("\0")
    .filter((path) => path.length > 0 && path !== guardFile)
    .sort();
}

async function builtFiles(): Promise<string[]> {
  if (!existsSync(distRoot)) return [];
  const glob = new Bun.Glob("**/*.{js,mjs,cjs,ts,json,map}");
  const files: string[] = [];
  for await (const entry of glob.scan({ cwd: distRoot, absolute: true })) files.push(entry);
  return files.sort();
}

describe("no shared cloud runtime boundary", () => {
  test("declares no dependency on the retired shared cloud runtime", () => {
    const declared = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ];
    expect(declared).not.toContain(retiredRuntime);
  });

  test("keeps the retired runtime out of the resolved lockfile", async () => {
    const lock = await Bun.file(new URL("../bun.lock", import.meta.url)).text();
    expect(lock).not.toContain(retiredRuntime);
    expect(lock).not.toContain(retiredRepo);
  });

  test("names the retired runtime in no tracked file", async () => {
    const files = trackedFiles();
    expect(files.length).toBeGreaterThan(50);
    expect(files).not.toContain(guardFile);

    const offenders: string[] = [];
    for (const path of files) {
      const text = await Bun.file(`${repoRoot}${path}`).text();
      if (text.includes(retiredRuntime) || text.includes(retiredRepo)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  test.skipIf(!existsSync(distRoot))("keeps the retired runtime out of built output", async () => {
    const files = await builtFiles();
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const lines = (await Bun.file(file).text()).split("\n");
      lines.forEach((line, index) => {
        if (!line.includes(retiredRuntime) && !line.includes(retiredRepo)) return;
        if (line.includes(vendoredDenylistDeclaration)) return;
        offenders.push(`${relative(repoRoot, file)}:${index + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  test("still ships both usage-ledger backends from in-repo adapters", async () => {
    const { SqliteAdapter } = await import("../src/db/sqlite-adapter");
    const { PgAdapterAsync } = await import("../src/db/pg-adapter");
    expect(typeof SqliteAdapter).toBe("function");
    expect(typeof PgAdapterAsync).toBe("function");
  });
});
