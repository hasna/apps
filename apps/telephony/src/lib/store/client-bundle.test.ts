import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The SQLite engine must not be inside the shipped client bins.
 *
 * `dist/cli/index.js` (`telephony`) and `dist/mcp/index.js` (`telephony-mcp`)
 * are what a fleet station installs and runs with a hosted credential. A bin
 * that LINKS `bun:sqlite` is one bad branch — a caught error, a refactored
 * default, a new sub-store — away from silently serving on-box data to
 * somebody who believes they are on the fleet. Keeping the engine out of the
 * bundle turns that class of regression from a policy question into a link
 * error.
 *
 * The on-box store is still fully supported: it is emitted as its own module
 * (`dist/local/local-store.js`, built from src/lib/store/local-store.ts) and
 * loaded through the ONE gated runtime import in
 * src/lib/store/local-store-loader.ts, which refuses unless the explicit
 * `HASNA_TELEPHONY_LOCAL=1` opt-in selected local mode.
 *
 * This suite bundles the real entrypoints with the same `bun build`
 * invocation the build script uses (spawned, not the in-process Bun.build API,
 * which resolves `.js` specifiers differently under the test runner), so it
 * grades what would actually ship rather than a committed `dist/` that may be
 * stale or absent.
 */

const repoRoot = new URL("../../../", import.meta.url).pathname; // apps/telephony/
const EXTERNALS = ["@modelcontextprotocol/sdk", "twilio", "pg", "@hasna/contracts", "@aws-sdk/client-s3"];

/** Bundle one entry the way `bun run build` does and return every emitted .js. */
function bundle(entry: string): Record<string, string> {
  const outDir = mkdtempSync(join(tmpdir(), "telephony-client-bundle-"));
  try {
    const build = Bun.spawnSync(
      [
        process.execPath,
        "build",
        join(repoRoot, entry),
        "--outdir",
        outDir,
        "--target",
        "bun",
        ...EXTERNALS.flatMap((name) => ["--external", name]),
      ],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
    );
    expect(build.stderr.toString()).not.toContain("error:");
    expect(build.exitCode).toBe(0);
    const emitted: Record<string, string> = {};
    for (const file of new Bun.Glob("**/*.js").scanSync(outDir)) {
      emitted[file] = readFileSync(join(outDir, file), "utf8");
    }
    // A bundle that emitted nothing would make every assertion below vacuous.
    expect(Object.keys(emitted).length).toBeGreaterThan(0);
    return emitted;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

describe("bun:sqlite is not linked into the client bins", () => {
  it("the CLI entry bundles without the SQLite engine, in every emitted file", () => {
    for (const [file, code] of Object.entries(bundle("src/cli/index.ts"))) {
      expect(`${file}: ${code.includes("bun:sqlite") ? "has bun:sqlite" : "clean"}`).toBe(`${file}: clean`);
    }
  });

  it("the MCP entry bundles without the SQLite engine, in every emitted file", () => {
    for (const [file, code] of Object.entries(bundle("src/mcp/index.ts"))) {
      expect(`${file}: ${code.includes("bun:sqlite") ? "has bun:sqlite" : "clean"}`).toBe(`${file}: clean`);
    }
  });

  it("the ./sdk entry bundles without the SQLite engine", () => {
    for (const [file, code] of Object.entries(bundle("src/sdk.ts"))) {
      expect(`${file}: ${code.includes("bun:sqlite") ? "has bun:sqlite" : "clean"}`).toBe(`${file}: clean`);
    }
  });

  /**
   * The counter-control: the local-store entry MUST carry the engine. Without
   * this, the three assertions above would still pass if the on-box store had
   * simply been deleted or stopped importing `../../db/*` — a green run that
   * proved nothing about where the engine went.
   */
  it("the local-store entry DOES carry the engine — the opt-in still has a real store", () => {
    const emitted = bundle("src/lib/store/local-store.ts");
    const withEngine = Object.entries(emitted).filter(([, code]) => code.includes("bun:sqlite"));
    expect(withEngine.map(([file]) => file)).toEqual(["local-store.js"]);
  });

  /**
   * And the build script has to actually emit that entry, or an installed
   * package would have a loader pointing at a file that was never built.
   */
  it("the build script emits the local-store entry outside dist/cli and dist/mcp", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    expect(pkg.scripts.build).toContain("bun build src/lib/store/local-store.ts --outdir dist/local");
    expect(pkg.bin.telephony).toBe("dist/cli/index.js");
    expect(pkg.bin["telephony-mcp"]).toBe("dist/mcp/index.js");
  });
});
