import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODE_DATA, MODE_SCRIPT } from "./manifest.js";
import { manifestFilesFor, ownBytes, type BundleEntry } from "./pack.js";
import {
  buildManifest,
  bundleDir,
  bundleRoot,
  definitionCarriesPrompt,
  inspectLocalBundle,
  installBundleTree,
  loopToDefinition,
  parseDefinition,
  readBundleMarker,
  writeBundleMarker,
  writeBundleSkeleton,
  type LoopBundleDefinition,
} from "./local.js";
import type { Loop } from "../../types.js";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "loops-local-"));
  roots.push(dir);
  return dir;
}

function definition(overrides: Record<string, unknown> = {}): LoopBundleDefinition {
  return {
    schema: "hasna.loop.bundle.v1",
    id: "lp_1",
    name: "demo",
    status: "active",
    schedule: { type: "interval", everyMs: 60_000 },
    target: { type: "command", command: "scripts/run.sh", args: [] },
    ...overrides,
  } as LoopBundleDefinition;
}

function entries(files: Record<string, string>): BundleEntry[] {
  return Object.entries(files)
    .map(([path, body]) => ({
      path,
      mode: path.startsWith("scripts/") ? MODE_SCRIPT : MODE_DATA,
      bytes: ownBytes(new TextEncoder().encode(body)),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
}

describe("bundleRoot", () => {
  test("is a sub-layer of the data home, never the app root itself", () => {
    const resolved = bundleRoot({});
    expect(resolved.endsWith("/loops/loops")).toBe(true);
  });

  test("honours the test escape hatch and refuses an unusable bundle name", () => {
    const dir = root();
    expect(bundleDir("demo", { LOOPS_BUNDLE_ROOT: dir })).toBe(join(dir, "demo"));
    expect(() => bundleDir("Demo", { LOOPS_BUNDLE_ROOT: dir })).toThrow();
  });
});

describe("loop.json projection", () => {
  const loop = {
    id: "lp_1",
    name: "demo",
    status: "active",
    schedule: { type: "interval", everyMs: 60_000 },
    target: { type: "command", command: "scripts/run.sh" },
    catchUp: "none",
    catchUpLimit: 1,
    overlap: "skip",
    maxAttempts: 3,
    retryDelayMs: 1000,
    leaseMs: 900_000,
    nextRunAt: "2026-09-04T12:00:00.000Z",
    retryScheduledFor: "2026-09-04T13:00:00.000Z",
    latestRunId: "run_1",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
  } as Loop;

  test("carries the definition and NOT the runtime columns", () => {
    const projected = loopToDefinition(loop) as Record<string, unknown>;
    expect(projected).toMatchObject({ id: "lp_1", name: "demo", status: "active", maxAttempts: 3 });
    // A bundle that carried nextRunAt would resurrect a stale schedule on every
    // station that pulled it, all at once.
    for (const key of ["nextRunAt", "retryScheduledFor", "latestRunId", "createdAt", "updatedAt"]) {
      expect(projected[key]).toBeUndefined();
    }
  });

  test("parseDefinition drops runtime keys but preserves unknown ones", () => {
    const parsed = parseDefinition({ ...definition({ futureField: "keep me" }), nextRunAt: "2026-01-01T00:00:00.000Z" }) as Record<string, unknown>;
    expect(parsed.futureField).toBe("keep me");
    expect(parsed.nextRunAt).toBeUndefined();
  });

  test("parseDefinition refuses a wrong or missing schema tag", () => {
    expect(() => parseDefinition({ ...definition(), schema: "other" })).toThrow(/schema/);
    expect(() => parseDefinition("nope")).toThrow(/must be a JSON object/);
  });

  test("carriesPrompt is true only for an agent target holding a live prompt", () => {
    expect(definitionCarriesPrompt(definition())).toBe(false);
    expect(definitionCarriesPrompt(definition({ target: { type: "agent", provider: "codewith" } }))).toBe(false);
    expect(definitionCarriesPrompt(definition({ target: { type: "agent", provider: "codewith", prompt: "do it" } }))).toBe(true);
  });
});

describe("writeBundleSkeleton", () => {
  test("writes the required files with contract modes", () => {
    const dir = join(root(), "demo");
    const manifest = writeBundleSkeleton(dir, "demo", definition(), { readme: "notes\n" });
    expect(manifest.version).toBe(0);
    expect(readdirSync(dir).sort()).toEqual(["README.md", "loop.json", "manifest.json", "scripts"]);
    expect(statSync(join(dir, "loop.json")).mode & 0o777).toBe(MODE_DATA);
    expect(statSync(join(dir, "scripts")).mode & 0o777).toBe(0o700);
    expect(manifest.files.map((file) => file.path).sort()).toEqual(["README.md", "loop.json"]);
  });
});

describe("installBundleTree", () => {
  const tree = entries({
    "loop.json": JSON.stringify(definition()),
    "scripts/run.sh": "#!/bin/sh\necho v2\n",
  });
  const manifest = buildManifest({ name: "demo", loopId: "lp_1", version: 2, files: manifestFilesFor(tree) });

  test("installs with contract modes and leaves no staging directory behind", () => {
    const parent = root();
    const dir = join(parent, "demo");
    installBundleTree(dir, tree, manifest);
    expect(statSync(join(dir, "scripts", "run.sh")).mode & 0o777).toBe(MODE_SCRIPT);
    expect(statSync(join(dir, "manifest.json")).mode & 0o777).toBe(MODE_DATA);
    expect(readdirSync(parent)).toEqual(["demo"]);
  });

  test("replaces an existing tree wholesale, removing files the new version dropped", () => {
    const dir = join(root(), "demo");
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "scripts", "old.sh"), "#!/bin/sh\n");
    installBundleTree(dir, tree, manifest);
    expect(existsSync(join(dir, "scripts", "old.sh"))).toBe(false);
    expect(readFileSync(join(dir, "scripts", "run.sh"), "utf8")).toBe("#!/bin/sh\necho v2\n");
  });

  test("a failure mid-install leaves the OLD tree, not a mixture of both", () => {
    const parent = root();
    const dir = join(parent, "demo");
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "scripts", "old.sh"), "#!/bin/sh\necho old\n");
    writeFileSync(join(dir, "loop.json"), "{}");

    expect(() =>
      installBundleTree(dir, tree, manifest, {
        onStaged: () => {
          throw new Error("injected failure after staging, before the swap");
        },
      }),
    ).toThrow(/injected failure/);

    // The old tree is intact and no staging or backup directory survives.
    expect(readFileSync(join(dir, "scripts", "old.sh"), "utf8")).toBe("#!/bin/sh\necho old\n");
    expect(existsSync(join(dir, "scripts", "run.sh"))).toBe(false);
    expect(readdirSync(parent)).toEqual(["demo"]);
  });
});

describe("markers and drift", () => {
  test("classifies absent, clean and dirty, and lists the changed paths", () => {
    const bundles = root();
    const env = { LOOPS_BUNDLE_ROOT: bundles };
    expect(inspectLocalBundle("demo", env).state).toBe("absent");

    const dir = join(bundles, "demo");
    writeBundleSkeleton(dir, "demo", definition());
    expect(inspectLocalBundle("demo", env)).toMatchObject({ state: "clean", changedPaths: [] });

    writeFileSync(join(dir, "scripts", "added.sh"), "#!/bin/sh\n", { mode: MODE_SCRIPT });
    const dirty = inspectLocalBundle("demo", env);
    expect(dirty.state).toBe("dirty");
    expect(dirty.changedPaths).toEqual(["scripts/added.sh"]);
  });

  test("a directory with no manifest is unmanaged, so nothing may overwrite it", () => {
    const bundles = root();
    const dir = join(bundles, "demo");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "handwritten.txt"), "mine\n");
    expect(inspectLocalBundle("demo", { LOOPS_BUNDLE_ROOT: bundles }).state).toBe("unmanaged");
  });

  test("a corrupt marker reads as NO marker, so the directory stays unmanaged", () => {
    const bundles = root();
    const dir = join(bundles, "demo");
    writeBundleSkeleton(dir, "demo", definition());
    writeFileSync(join(dir, ".loops-bundle.json"), "{not json");
    expect(readBundleMarker(dir)).toBeUndefined();
  });

  test("a marker round-trips with 0600 and its pin", () => {
    const dir = join(root(), "demo");
    writeBundleSkeleton(dir, "demo", definition());
    writeBundleMarker(dir, {
      bundle: "demo",
      loopId: "lp_1",
      version: 7,
      pinnedVersion: 7,
      bundleDigest: `sha256:${"a".repeat(64)}`,
      source: "pull",
      apiUrl: "https://api.example/loops/v1",
      syncedAt: "2026-09-04T00:00:00.000Z",
    });
    expect(statSync(join(dir, ".loops-bundle.json")).mode & 0o777).toBe(MODE_DATA);
    expect(readBundleMarker(dir)).toMatchObject({ managedBy: "@hasna/loops", version: 7, pinnedVersion: 7, source: "pull" });
  });

  test("the marker is never packed into the bundle", () => {
    const bundles = root();
    const dir = join(bundles, "demo");
    writeBundleSkeleton(dir, "demo", definition());
    writeBundleMarker(dir, {
      bundle: "demo",
      loopId: "lp_1",
      version: 1,
      pinnedVersion: null,
      bundleDigest: `sha256:${"a".repeat(64)}`,
      source: "push",
      syncedAt: "2026-09-04T00:00:00.000Z",
    });
    // Adding the marker must not make the tree dirty: it is excluded from the
    // file set, so a pulled bundle re-packs to the digest it arrived with.
    expect(inspectLocalBundle("demo", { LOOPS_BUNDLE_ROOT: bundles }).state).toBe("clean");
  });
});
