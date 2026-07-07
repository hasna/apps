import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAppRecord,
  dedupeByNpmName,
  excludedFolderReason,
  readSeedCandidate,
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
  it("excludes worktree/dup checkout name patterns", () => {
    expect(excludedFolderReason("open-loops-wt-codewith-exec")).toContain("worktree");
    expect(excludedFolderReason("open-knowledge-pr6-generated")).toContain("pull-request");
    expect(excludedFolderReason("open-projects-release-0.1.78")).toContain("release");
    expect(excludedFolderReason("open-knowledge-lock-fix")).toContain("fix");
    expect(excludedFolderReason("open-assistants-legacy")).toContain("legacy");
    expect(excludedFolderReason("open-codewith-agent-daemon-aaa695d2")).toContain("hash");
    expect(excludedFolderReason("opensourcedev")).toContain("not an open-");
  });

  it("excludes known duplicate checkouts", () => {
    expect(excludedFolderReason("open-mailery")).toContain("open-emails");
    expect(excludedFolderReason("open-shield")).toContain("open-security");
    expect(excludedFolderReason("open-codewith-qa")).toContain("open-codewith");
  });

  it("keeps canonical repos, including names containing pr/fix substrings", () => {
    expect(excludedFolderReason("open-projects")).toBeNull();
    expect(excludedFolderReason("open-prompts")).toBeNull();
    expect(excludedFolderReason("open-todos")).toBeNull();
    expect(excludedFolderReason("open-feedback")).toBeNull();
  });
});

describe("readSeedCandidate", () => {
  it("reads package.json name/version/bin and README first line", () => {
    makeRepo(
      "open-todos",
      {
        name: "@hasna/todos",
        version: "1.2.3",
        description: "Task tracking",
        bin: { todos: "dist/cli.js", "todos-mcp": "dist/mcp.js" },
      },
      { readme: "# open-todos\n\nTask and plan tracking.\n" }
    );
    const candidate = readSeedCandidate(root, "open-todos");
    expect(candidate?.npmName).toBe("@hasna/todos");
    expect(candidate?.version).toBe("1.2.3");
    expect(candidate?.bins).toEqual(["todos", "todos-mcp"]);
    expect(candidate?.readmeFirstLine).toBe("open-todos");
  });

  it("skips badge lines when reading the README first line", () => {
    makeRepo("open-x", { name: "@hasna/x" }, { readme: "[![ci](https://x/badge.svg)](https://x)\n\nReal summary line\n" });
    expect(readSeedCandidate(root, "open-x")?.readmeFirstLine).toBe("Real summary line");
  });

  it("derives a bin name from string bin fields", () => {
    makeRepo("open-y", { name: "@hasna/y", bin: "dist/cli.js" });
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
      candidate("open-projects-chief-projects-report-render", "@hasna/projects"),
      candidate("open-projects", "@hasna/projects"),
    ]);
    expect(kept.map((c) => c.folder)).toEqual(["open-projects"]);
    expect(dropped[0]?.folder).toBe("open-projects-chief-projects-report-render");
  });

  it("falls back to the shortest folder name", () => {
    const { kept } = dedupeByNpmName([
      candidate("open-codewith-extra", "codewith-monorepo"),
      candidate("open-codewith", "codewith-monorepo"),
    ]);
    expect(kept.map((c) => c.folder)).toEqual(["open-codewith"]);
  });
});

describe("buildAppRecord", () => {
  it("builds a valid hasna.app.v1 doc with mcp surface and project join", () => {
    makeRepo("open-todos", {
      name: "@hasna/todos",
      version: "1.2.3",
      description: "Task tracking",
      bin: { todos: "dist/cli.js", "todos-mcp": "dist/mcp.js" },
    });
    const candidate = readSeedCandidate(root, "open-todos")!;
    const app = buildAppRecord(candidate, {
      slug: "hasna-todos",
      primaryPath: candidate.path,
      gitRemote: "https://github.com/hasna/todos.git",
      description: null,
    });
    expect(app.schema).toBe("hasna.app.v1");
    expect(app.appId).toBe("open-todos");
    expect(app.githubUrl).toBe("https://github.com/hasna/todos.git");
    expect(app.projectSlug).toBe("hasna-todos");
    expect(app.surfaces.mcp?.bin).toBe("todos-mcp");
    expect(app.lifecycle).toBe("active");
    expect(app.metadata?.["version"]).toBe("1.2.3");
  });

  it("falls back to the hasna github url and folder slug without a join", () => {
    makeRepo("open-min", { name: "@hasna/min" });
    const app = buildAppRecord(readSeedCandidate(root, "open-min")!);
    expect(app.githubUrl).toBe("https://github.com/hasna/open-min");
    expect(app.projectSlug).toBe("open-min");
  });
});

describe("seedCatalog", () => {
  it("scans, excludes, dedupes, seeds the store, and writes the JSONL fixture", () => {
    makeRepo("open-todos", { name: "@hasna/todos", version: "1.0.0", bin: { todos: "x" } });
    makeRepo("open-todos-wt-routing-doctor", { name: "@hasna/todos" });
    makeRepo("open-mailery", { name: "@hasna/mailery" });
    makeRepo("open-emails", { name: "@hasna/mailery", version: "2.0.0" });
    makeRepo("open-emails-extra-checkout", { name: "@hasna/mailery", version: "2.0.0" });
    makeRepo("open-nopkg", null);
    makeRepo("open-nogit", { name: "@hasna/nogit" }, { git: false });

    const store = new CatalogStore({ dbPath: ":memory:" });
    const fixturePath = join(root, "fixtures", "apps.seed.jsonl");
    const report = seedCatalog({ root, store, fixturePath, now: "2026-07-06T09:00:00.000Z" });

    expect(report.seeded.map((app) => app.appId).sort()).toEqual(["open-emails", "open-todos"]);
    expect(report.skipped.map((skip) => skip.folder).sort()).toEqual([
      "open-emails-extra-checkout",
      "open-mailery",
      "open-nogit",
      "open-nopkg",
      "open-todos-wt-routing-doctor",
    ]);
    expect(store.countApps()).toBe(2);
    const lines = readFileSync(fixturePath, "utf8").trim().split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]!).schema).toBe("hasna.app.v1");
  });
});
