import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../../package.json";

/**
 * The shipped CLI and MCP bundles must contain NO `bun:sqlite`.
 *
 * This is the fail-closed residue the fleet audit counts (W12, 2026-09-11).
 * Routing already refuses the local store in a hosted run, but a bundle that
 * still CARRIES it is one stray import away from silently serving a different
 * dataset, and it makes every `grep -c bun:sqlite dist/cli/*.js` on a station
 * report a non-zero number that nobody can explain. The local store therefore
 * hangs off ONE dynamic `import("../db/local.js")` inside `LocalConfigStore`,
 * and the cli/mcp build steps run with `--splitting --chunk-naming
 * "chunks/[name]-[hash].[ext]"` so the bundler emits it OUTSIDE `dist/cli` and
 * `dist/mcp`.
 *
 * The test is two-sided, like the `./sdk` self-containment test: it runs the
 * REAL build commands out of package.json (not a copy that can drift), and the
 * same scan must FIND `bun:sqlite` in a deliberately unsplit build of the same
 * entrypoint — so a scan that cannot fire cannot pass.
 */

const root = join(import.meta.dir, "../..");
const ENTRIES = [
  { label: "cli", entry: "src/cli/index.tsx", out: "cli" },
  { label: "mcp", entry: "src/mcp/index.ts", out: "mcp" },
] as const;
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The real `bun build` segment for an entrypoint, read from package.json. */
function buildCommand(entry: string): string {
  const segments = packageJson.scripts.build.split("&&").map((segment) => segment.trim());
  const matches = segments.filter((segment) => segment.startsWith(`bun build ${entry} `));
  expect(matches).toHaveLength(1);
  const command = matches[0]!;
  expect(command).toContain("--outdir dist --root src");
  expect(command).toContain("--splitting");
  return command;
}

function build(entry: string, { splitting = true } = {}): string {
  const outDir = mkdtempSync(join(tmpdir(), "instructions-client-bundle-"));
  tempDirs.push(outDir);
  let command = buildCommand(entry).replace("--outdir dist ", `--outdir ${JSON.stringify(outDir)} `);
  if (!splitting) {
    command = command
      .replace(" --splitting", "")
      .replace(' --chunk-naming "chunks/[name]-[hash].[ext]"', "");
  }
  const built = Bun.spawnSync(["sh", "-c", command], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect(built.stderr.toString() + built.stdout.toString()).not.toContain("error:");
  expect(built.exitCode).toBe(0);
  return outDir;
}

function sqliteRefs(file: string): number {
  return readFileSync(file, "utf8").split("bun:sqlite").length - 1;
}

describe("client bundles carry no on-box SQLite", () => {
  for (const { label, entry, out } of ENTRIES) {
    test(`${label}: every file in dist/${out} has zero bun:sqlite references`, () => {
      const outDir = build(entry);
      const entryDir = join(outDir, out);
      const files = readdirSync(entryDir).filter((name) => name.endsWith(".js"));
      expect(files.length).toBeGreaterThan(0);
      for (const name of files) {
        expect({ file: `dist/${out}/${name}`, refs: sqliteRefs(join(entryDir, name)) }).toEqual({
          file: `dist/${out}/${name}`,
          refs: 0,
        });
      }
    });

    test(`${label}: the local store is still shipped, as a chunk outside dist/${out}`, () => {
      const outDir = build(entry);
      const chunks = readdirSync(join(outDir, "chunks")).filter((name) => name.endsWith(".js"));
      const withSqlite = chunks.filter((name) => sqliteRefs(join(outDir, "chunks", name)) > 0);
      // The opt-in local mode must keep working: the code is present, just not
      // in the entry bundle. Zero here would mean the store was dropped.
      expect(withSqlite.length).toBeGreaterThan(0);
    });

    test(`${label}: the scan fires — an unsplit build of the same entry DOES contain bun:sqlite`, () => {
      const outDir = build(entry, { splitting: false });
      expect(sqliteRefs(join(outDir, out, "index.js"))).toBeGreaterThan(0);
    });
  }
});
