import { describe, expect, test } from "bun:test";

/**
 * The retired shared cloud runtime, assembled at runtime rather than written as one
 * literal. A byte-level scanner cannot tell a guard assertion apart from a real import,
 * so spelling the name out here would make this very file look like the breach it exists
 * to prevent.
 */
const retiredRuntime = ["@hasna", "cloud"].join("/");
const retiredRepo = ["open", "cloud"].join("-");

const manifest = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

async function sourceFiles(): Promise<string[]> {
  const root = new URL("../src/", import.meta.url).pathname;
  const glob = new Bun.Glob("**/*.ts");
  const files: string[] = [];
  for await (const entry of glob.scan({ cwd: root, absolute: true })) files.push(entry);
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

  test("imports the retired runtime from no source file", async () => {
    const files = await sourceFiles();
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const text = await Bun.file(file).text();
      if (text.includes(retiredRuntime) || text.includes(retiredRepo)) offenders.push(file);
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
