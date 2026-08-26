import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const repoRoot = join(import.meta.dir, "..");

/** The real path of the installed `@hasna/paths` package (bun resolves it from its `.bun` store). */
const PATHS_PKG_DIR = realpathSync(join(repoRoot, "node_modules", "@hasna", "paths"));

/**
 * bun's bundler cannot re-inline the registry-installed `@hasna/paths` once the test
 * runner has already loaded it through the module graph — the subsequent `Bun.build`
 * throws `Unexpected reading file` (bun issue class oven-sh/bun#9517). The node-compat
 * bundles therefore externalize `@hasna/paths`, exactly like the already-external
 * `@hasna/contracts`. A real Node consumer installs `@hasna/paths` (it is a runtime
 * dependency), so this provides node resolution through a real `node_modules` symlink
 * in the scratch dir.
 */
function linkPathsForNode(dir: string): void {
  const nm = join(dir, "node_modules", "@hasna");
  mkdirSync(nm, { recursive: true });
  symlinkSync(PATHS_PKG_DIR, join(nm, "paths"));
}

/** The error the default store raises when `bun:sqlite` cannot be loaded. */
const BUN_REQUIRED_ERROR =
  "SQLiteActionsStore requires the Bun runtime because bun:sqlite is unavailable; use JsonActionsStore instead";

/**
 * The published entry points are consumed from Node as well as Bun, so nothing in the
 * `.`, `./sdk`, or `./storage` module graph may import a `bun:` builtin at module scope.
 */
const staticBunImport = /^\s*import[^\n]*"bun:[^"]*"/m;

const entrypoints: Array<{ name: string; path: string }> = [
  { name: ".", path: join(import.meta.dir, "index.ts") },
  { name: "./sdk", path: join(import.meta.dir, "sdk", "index.ts") },
  { name: "./storage", path: join(import.meta.dir, "storage.ts") },
];

async function bundle(entrypoint: string): Promise<string> {
  const built = await Bun.build({
    entrypoints: [entrypoint],
    target: "bun",
    external: ["@hasna/contracts", "@hasna/paths"],
  });
  expect(built.success).toBe(true);
  return built.outputs[0]!.text();
}

describe("published entry points load under Node", () => {
  for (const entrypoint of entrypoints) {
    test(`${entrypoint.name} has no module-scope bun: import and imports under Node`, async () => {
      const code = await bundle(entrypoint.path);
      expect(staticBunImport.test(code)).toBe(false);

      const node = Bun.which("node");
      if (!node) return;

      const dir = mkdtempSync(join(tmpdir(), "actions-node-compat-"));
      try {
        linkPathsForNode(dir);
        const bundlePath = join(dir, "bundle.mjs");
        writeFileSync(bundlePath, code);
        const child = Bun.spawnSync([
          node,
          "--input-type=module",
          "-e",
          `await import(${JSON.stringify(`file://${bundlePath}`)});`,
        ], { stdout: "pipe", stderr: "pipe" });
        expect(child.stderr.toString()).toBe("");
        expect(child.exitCode).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

/**
 * The default store is SQLite, which only the Bun runtime can open. Node consumers keep
 * working through an explicit `JsonActionsStore`, so both halves of that contract are
 * exercised in a real `node` process rather than asserted from Bun.
 */
describe("the default store outside Bun", () => {
  test("raises the documented error while JsonActionsStore keeps working", async () => {
    const node = Bun.which("node");
    if (!node) return;

    const code = await bundle(join(import.meta.dir, "index.ts"));
    const dir = mkdtempSync(join(tmpdir(), "actions-node-store-"));
    try {
      linkPathsForNode(dir);
      const bundlePath = join(dir, "bundle.mjs");
      writeFileSync(bundlePath, code);
      const dataDir = join(dir, "data");
      const child = Bun.spawnSync([
        node,
        "--input-type=module",
        "-e",
        `
        const { ActionsClient, JsonActionsStore } = await import(${JSON.stringify(`file://${bundlePath}`)});
        const dataDir = ${JSON.stringify(dataDir)};
        let defaultError = null;
        try {
          await new ActionsClient({ dataDir }).listManifests();
        } catch (error) {
          defaultError = error.message;
        }
        const manifests = await new ActionsClient({ store: new JsonActionsStore(dataDir) }).listManifests();
        console.log(JSON.stringify({ defaultError, manifests }));
        `,
      ], { stdout: "pipe", stderr: "pipe" });
      expect(child.stderr.toString()).toBe("");
      expect(child.exitCode).toBe(0);

      const result = JSON.parse(child.stdout.toString()) as { defaultError: string | null; manifests: unknown[] };
      expect(result.defaultError).toBe(BUN_REQUIRED_ERROR);
      expect(result.manifests).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the Bun runtime requirement is declared and documented", () => {
  test("package.json declares engines.bun", () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8")) as {
      engines?: Record<string, string>;
    };
    expect(typeof manifest.engines?.bun).toBe("string");
  });

  test("the README SDK section points non-Bun consumers at JsonActionsStore", () => {
    const sdk = readmeSection("## SDK");
    expect(sdk).toContain("new JsonActionsStore()");
    expect(sdk).toContain("Bun");
  });
});

function readmeSection(heading: string): string {
  const readme = readFileSync(join(repoRoot, "README.md"), "utf-8");
  const start = readme.indexOf(`\n${heading}\n`);
  expect(start).toBeGreaterThan(-1);
  const body = readme.slice(start + heading.length + 2);
  const end = body.indexOf("\n## ");
  return end === -1 ? body : body.slice(0, end);
}
