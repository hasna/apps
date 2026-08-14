import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAppRecord,
  dedupeByNpmName,
  DEFAULT_SEED_SOURCE,
  DUPLICATE_CHECKOUTS,
  excludedFolderReason,
  loadDuplicateCheckouts,
  readSeedCandidate,
  resolveDuplicateCheckouts,
  seedCatalog,
} from "../src/seed.js";
import { CatalogStore } from "../src/store.js";
import type { SeedCandidate } from "../src/types.js";

let root: string;

function makeRepo(
  folder: string,
  pkg: Record<string, unknown> | null,
  options: { readme?: string; git?: boolean } = {}
): void {
  const path = join(root, folder);
  mkdirSync(path, { recursive: true });
  if (options.git !== false) mkdirSync(join(path, ".git"), { recursive: true });
  if (pkg) writeFileSync(join(path, "package.json"), JSON.stringify(pkg, null, 2));
  if (options.readme) writeFileSync(join(path, "README.md"), options.readme);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "catalog-seed-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("excludedFolderReason", () => {
  it("excludes worktree/dup checkout name patterns without any inventory", () => {
    // These need no list of real repos — the shape of the folder name is enough.
    expect(excludedFolderReason("open-alpha-wt-some-task")).toContain("worktree");
    expect(excludedFolderReason("open-alpha-pr6-generated")).toContain("pull-request");
    expect(excludedFolderReason("open-alpha-release-0.1.78")).toContain("release");
    expect(excludedFolderReason("open-alpha-lock-fix")).toContain("fix");
    expect(excludedFolderReason("open-alpha-legacy")).toContain("legacy");
    expect(excludedFolderReason("open-alpha-daemon-aaa695d2")).toContain("hash");
    expect(excludedFolderReason("opensourcedev")).toContain("not an open-");
  });

  it("ships no built-in duplicate map — aliases are operator configuration", () => {
    // 0.1.0 hardcoded six real repo folder names here and published them in
    // `dist/`. The default is now empty; nothing is excluded by name alone.
    //
    // Assert the MAP, not just a couple of probe folders: the 0.1.0 entries were
    // none of the names used in these tests, so probing alone stayed green with
    // the whole inventory restored. Emptiness is the property being pinned.
    expect(DUPLICATE_CHECKOUTS).toEqual({});
    expect(Object.keys(DUPLICATE_CHECKOUTS)).toHaveLength(0);
    expect(excludedFolderReason("open-alpha")).toBeNull();
    expect(excludedFolderReason("open-beta")).toBeNull();
  });

  it("excludes duplicate checkouts supplied at call time", () => {
    const duplicates = { "open-alpha": "open-beta" };
    expect(excludedFolderReason("open-alpha", duplicates)).toContain("open-beta");
    expect(excludedFolderReason("open-beta", duplicates)).toBeNull();
  });

  it("keeps canonical repos, including names containing pr/fix substrings", () => {
    expect(excludedFolderReason("open-gamma")).toBeNull();
    expect(excludedFolderReason("open-delta")).toBeNull();
    expect(excludedFolderReason("open-alpha")).toBeNull();
    expect(excludedFolderReason("open-epsilon")).toBeNull();
  });
});

describe("duplicate-checkout configuration", () => {
  it("loads and validates an alias map from a file", () => {
    const path = join(root, "duplicates.json");
    writeFileSync(path, JSON.stringify({ "open-alpha": "open-beta" }));
    expect(loadDuplicateCheckouts(path)).toEqual({ "open-alpha": "open-beta" });

    const bad = join(root, "bad.json");
    writeFileSync(bad, JSON.stringify(["open-alpha"]));
    expect(() => loadDuplicateCheckouts(bad)).toThrow(/must be an object/);

    const nonString = join(root, "non-string.json");
    writeFileSync(nonString, JSON.stringify({ "open-alpha": 1 }));
    expect(() => loadDuplicateCheckouts(nonString)).toThrow(/must map to a folder name/);
  });

  it("resolves from an explicit path, then the env var, then nothing", () => {
    const path = join(root, "duplicates.json");
    writeFileSync(path, JSON.stringify({ "open-alpha": "open-beta" }));
    expect(resolveDuplicateCheckouts(path)).toEqual({ "open-alpha": "open-beta" });

    const previous = process.env["CATALOG_DUPLICATE_CHECKOUTS"];
    try {
      delete process.env["CATALOG_DUPLICATE_CHECKOUTS"];
      expect(resolveDuplicateCheckouts()).toEqual({});
      process.env["CATALOG_DUPLICATE_CHECKOUTS"] = path;
      expect(resolveDuplicateCheckouts()).toEqual({ "open-alpha": "open-beta" });
    } finally {
      if (previous === undefined) delete process.env["CATALOG_DUPLICATE_CHECKOUTS"];
      else process.env["CATALOG_DUPLICATE_CHECKOUTS"] = previous;
    }
  });
});

describe("readSeedCandidate", () => {
  it("reads package.json name/version/bin and README first line", () => {
    makeRepo(
      "open-alpha",
      {
        name: "@example/alpha",
        version: "1.2.3",
        description: "Task tracking",
        bin: { todos: "dist/cli.js", "todos-mcp": "dist/mcp.js" },
      },
      { readme: "# open-alpha\n\nTask and plan tracking.\n" }
    );
    const candidate = readSeedCandidate(root, "open-alpha");
    expect(candidate?.npmName).toBe("@example/alpha");
    expect(candidate?.version).toBe("1.2.3");
    expect(candidate?.bins).toEqual(["todos", "todos-mcp"]);
    expect(candidate?.readmeFirstLine).toBe("open-alpha");
  });

  it("skips badge lines when reading the README first line", () => {
    makeRepo("open-x", { name: "@example/x" }, { readme: "[![ci](https://x/badge.svg)](https://x)\n\nReal summary line\n" });
    expect(readSeedCandidate(root, "open-x")?.readmeFirstLine).toBe("Real summary line");
  });

  it("derives a bin name from string bin fields", () => {
    makeRepo("open-y", { name: "@example/y", bin: "dist/cli.js" });
    expect(readSeedCandidate(root, "open-y")?.bins).toEqual(["y"]);
  });

  it("returns null when there is no package.json", () => {
    makeRepo("open-z", null);
    expect(readSeedCandidate(root, "open-z")).toBeNull();
  });
});

describe("dedupeByNpmName", () => {
  const candidate = (folder: string, npmName: string): SeedCandidate => ({
    folder,
    path: `/x/${folder}`,
    npmName,
    version: null,
    description: null,
    bins: [],
    readmeFirstLine: null,
    repositoryUrl: null,
  });

  it("prefers the folder matching open-<unscoped npm name>", () => {
    const { kept, dropped } = dedupeByNpmName([
      candidate("open-beta-report-render", "@example/gamma"),
      candidate("open-gamma", "@example/gamma"),
    ]);
    expect(kept.map((c) => c.folder)).toEqual(["open-gamma"]);
    expect(dropped[0]?.folder).toBe("open-beta-report-render");
  });

  it("falls back to the shortest folder name", () => {
    const { kept } = dedupeByNpmName([
      candidate("open-kappa-extra", "codewith-monorepo"),
      candidate("open-kappa", "codewith-monorepo"),
    ]);
    expect(kept.map((c) => c.folder)).toEqual(["open-kappa"]);
  });
});

describe("buildAppRecord", () => {
  it("builds a valid hasna.app.v1 doc with mcp surface and project join", () => {
    makeRepo("open-alpha", {
      name: "@example/alpha",
      version: "1.2.3",
      description: "Task tracking",
      bin: { todos: "dist/cli.js", "todos-mcp": "dist/mcp.js" },
    });
    const candidate = readSeedCandidate(root, "open-alpha")!;
    const app = buildAppRecord(candidate, {
      slug: "hasna-todos",
      primaryPath: candidate.path,
      gitRemote: "https://github.com/example/todos.git",
      description: null,
    });
    expect(app.schema).toBe("hasna.app.v1");
    expect(app.appId).toBe("open-alpha");
    expect(app.githubUrl).toBe("https://github.com/example/todos.git");
    expect(app.projectSlug).toBe("hasna-todos");
    expect(app.surfaces.mcp?.bin).toBe("todos-mcp");
    expect(app.lifecycle).toBe("active");
    expect(app.metadata?.["version"]).toBe("1.2.3");
  });

  it("falls back to the default github org and folder slug without a join", () => {
    makeRepo("open-xi", { name: "@example/xi" });
    const app = buildAppRecord(readSeedCandidate(root, "open-xi")!);
    expect(app.githubUrl).toBe("https://github.com/hasna/open-xi");
    expect(app.projectSlug).toBe("open-xi");
  });

  it("stamps the provenance label it is given, never a baked-in one", () => {
    // 0.1.0 hardcoded `seededFrom: "opensource-scan"` here, so every emitted
    // record carried a captured-snapshot marker next to its key — the shape
    // `check:artifact` now fails on. The label must come from the caller.
    makeRepo("open-omicron", { name: "@example/omicron" });
    const candidate = readSeedCandidate(root, "open-omicron")!;
    const app = buildAppRecord(candidate, undefined, "2026-07-06T09:00:00.000Z", "operator-supplied-label");
    expect(app.metadata?.["seededFrom"]).toBe("operator-supplied-label");
  });

  it("defaults the provenance label to a generic DEFAULT_SEED_SOURCE", () => {
    // The default is deliberately generic. Pin the constant's value as well as
    // the wiring: a default that names a specific capture run is itself the
    // disclosure, and swapping only the constant would leave the wiring green.
    expect(DEFAULT_SEED_SOURCE).toBe("scan");
    makeRepo("open-pi", { name: "@example/pi" });
    const app = buildAppRecord(readSeedCandidate(root, "open-pi")!);
    expect(app.metadata?.["seededFrom"]).toBe(DEFAULT_SEED_SOURCE);
  });
});

describe("seedCatalog", () => {
  it("scans, excludes, dedupes, seeds the store, and writes the JSONL fixture", () => {
    makeRepo("open-alpha", { name: "@example/alpha", version: "1.0.0", bin: { alpha: "x" } });
    makeRepo("open-alpha-wt-routing-doctor", { name: "@example/alpha" });
    makeRepo("open-gamma", { name: "@example/beta" });
    makeRepo("open-beta", { name: "@example/beta", version: "2.0.0" });
    makeRepo("open-beta-extra-checkout", { name: "@example/beta", version: "2.0.0" });
    makeRepo("open-nopkg", null);
    makeRepo("open-nogit", { name: "@example/nogit" }, { git: false });

    const store = new CatalogStore({ dbPath: ":memory:" });
    const fixturePath = join(root, "fixtures", "apps.seed.jsonl");
    const report = seedCatalog({
      root,
      store,
      fixturePath,
      now: "2026-07-06T09:00:00.000Z",
      duplicateCheckouts: { "open-gamma": "open-beta" },
    });

    expect(report.seeded.map((app) => app.appId).sort()).toEqual(["open-alpha", "open-beta"]);
    expect(report.skipped.map((skip) => skip.folder).sort()).toEqual([
      "open-alpha-wt-routing-doctor",
      "open-beta-extra-checkout",
      "open-gamma",
      "open-nogit",
      "open-nopkg",
    ]);
    expect(store.countApps()).toBe(2);
    const lines = readFileSync(fixturePath, "utf8").trim().split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]!).schema).toBe("hasna.app.v1");
  });

  it("threads the provenance label through to every written record", () => {
    // The JSONL fixture is the file that leaked in 0.1.0, so the label that ends
    // up in it has to be the one the operator asked for, defaulting to generic.
    makeRepo("open-alpha", { name: "@example/alpha", version: "1.0.0" });
    makeRepo("open-beta", { name: "@example/beta", version: "2.0.0" });

    const fixturePath = join(root, "fixtures", "apps.seed.jsonl");
    const report = seedCatalog({ root, fixturePath, now: "2026-07-06T09:00:00.000Z", seededFrom: "manual-entry" });
    expect(report.seeded.map((app) => app.metadata?.["seededFrom"])).toEqual(["manual-entry", "manual-entry"]);
    for (const line of readFileSync(fixturePath, "utf8").trim().split("\n")) {
      expect(JSON.parse(line).metadata.seededFrom).toBe("manual-entry");
    }

    const fallback = seedCatalog({ root, now: "2026-07-06T09:00:00.000Z" });
    expect(fallback.seeded.map((app) => app.metadata?.["seededFrom"])).toEqual([
      DEFAULT_SEED_SOURCE,
      DEFAULT_SEED_SOURCE,
    ]);
  });
});
