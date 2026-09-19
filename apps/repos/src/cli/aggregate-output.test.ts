import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { closeDb, getDb } from "../db/database.js";
import { bulkInsertCommits, upsertRepo } from "../db/repos.js";
import {
  AGGREGATE_JSON_MAX_BYTES,
  aggregatePageBytes,
  buildAggregatePage,
} from "./aggregate-output.js";

const ROOT = resolve(import.meta.dir, "../..");
const CLI = resolve(ROOT, "src/cli/index.tsx");
const tempRoots: string[] = [];

interface Fixture {
  dbPath: string;
  binPath: string;
  rootRepoName: string;
}

function seedLargeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "repos-aggregate-output-"));
  tempRoots.push(root);
  const dbPath = join(root, "repos.db");
  const binPath = join(root, "bin");
  mkdirSync(binPath);

  const gitShim = join(binPath, "git");
  writeFileSync(gitShim, `#!/usr/bin/env python3
import sys
args = sys.argv[1:]
if "status" in args and "--porcelain" in args:
    print(" M tracked.txt")
    print("?? untracked.txt")
    print("M  staged.txt")
elif "symbolic-ref" in args:
    print("main")
elif "rev-list" in args and args[-1] == "@{upstream}..HEAD":
    print("3")
elif "rev-list" in args and args[-1] == "HEAD..@{upstream}":
    print("4")
elif "fetch" in args:
    pass
`);
  chmodSync(gitShim, 0o755);

  closeDb();
  process.env["HASNA_REPOS_DB_PATH"] = dbPath;
  const db = getDb(dbPath);
  const repos: Array<{ id: number; name: string }> = [];
  const commits: Parameters<typeof bulkInsertCommits>[0] = [];
  const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const longPathSegment = "nested-path-segment-".repeat(28);

  for (let index = 0; index < 60; index += 1) {
    const name = `aggregate-repository-${String(index).padStart(3, "0")}-${"long-name-".repeat(14)}`;
    const repo = upsertRepo({
      path: `/workspace/repositories/${longPathSegment}/${name}`,
      name,
      org: `organization-${index % 4}-${"wide-".repeat(16)}`,
      remote_url: `github.com/hasna/${name}`,
      default_branch: "main",
      commit_count: 1,
      branch_count: 1,
      tag_count: 0,
    });
    repos.push({ id: repo.id, name });
    commits.push({
      repo_id: repo.id,
      sha: `${index.toString(16).padStart(40, "0")}`,
      author_name: `Aggregate Author ${index % 9} ${"verbose-".repeat(16)}`,
      author_email: "aggregate@example.com",
      date: index < 30 ? "2000-01-01T00:00:00.000Z" : recent,
      message: `fixture commit ${index}`,
      files_changed: 1,
      insertions: 100 + index,
      deletions: index,
    });
  }
  bulkInsertCommits(commits);

  const rootRepo = repos[0]!;
  const insertEdge = db.query(`
    INSERT INTO edges (source_type, source_id, relation, target_type, target_id, weight)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const dependency of repos.slice(1, 31)) {
    insertEdge.run("repo", String(rootRepo.id), "depends_on", "repo", String(dependency.id), 1);
  }
  for (let index = 0; index < 30; index += 1) {
    const email = `cross-org-author-${String(index).padStart(3, "0")}-${"wide-".repeat(24)}@example.com`;
    insertEdge.run("author", email, "works_in", "org", `org-${index}-alpha-${"wide-".repeat(14)}`, index + 1);
    insertEdge.run("author", email, "works_in", "org", `org-${index}-beta-${"wide-".repeat(14)}`, index + 2);
  }

  closeDb();
  delete process.env["HASNA_REPOS_DB_PATH"];
  return { dbPath, binPath, rootRepoName: rootRepo.name };
}

function runCli(fixture: Fixture, args: string[]): { stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "run", CLI, ...args],
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      PATH: `${fixture.binPath}:${process.env["PATH"] ?? ""}`,
      HASNA_REPOS_AUTO_BOOTSTRAP: "0",
      HASNA_REPOS_DB_PATH: fixture.dbPath,
      NO_COLOR: "1",
    },
  });
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  expect(result.exitCode, stderr).toBe(0);
  return { stdout, stderr };
}

function expectCompactPage(
  fixture: Fixture,
  args: string[],
  collection: "repos" | "dependencies" | "authors",
  total: number,
): Record<string, any> {
  const { stdout } = runCli(fixture, args);
  expect(Buffer.byteLength(stdout, "utf8")).toBeLessThanOrEqual(AGGREGATE_JSON_MAX_BYTES);
  expect(stdout.trimEnd()).not.toContain("\n");
  const page = JSON.parse(stdout) as Record<string, any>;
  expect(page).toMatchObject({
    count: 20,
    total,
    limit: 20,
    cursor: 0,
    next_cursor: 20,
    has_more: true,
    complete: false,
    compact: true,
    byte_limit: AGGREGATE_JSON_MAX_BYTES,
  });
  expect(page[collection]).toHaveLength(20);
  return page;
}

afterEach(() => {
  closeDb();
  delete process.env["HASNA_REPOS_DB_PATH"];
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("aggregate JSON paging helper", () => {
  test("enforces a whole-envelope UTF-8 ceiling and advances by rows actually returned", () => {
    const items = Array.from({ length: 80 }, (_, index) => ({
      id: index,
      path: `/${"deep/".repeat(100)}row-${index}`,
    }));
    const page = buildAggregatePage({
      collection: "items",
      items,
      cursor: 0,
      limit: 20,
      maxBytes: 2_048,
      project: (item) => item,
    });

    expect(page.count).toBeGreaterThan(0);
    expect(page.count).toBeLessThan(20);
    expect(page.next_cursor).toBe(page.count);
    expect(page.has_more).toBe(true);
    expect(aggregatePageBytes(page)).toBeLessThanOrEqual(2_048);
  });
});

describe("secondary aggregate CLI JSON", () => {
  test("defaults every aggregate to a 20-row compact minified continuation page", () => {
    const fixture = seedLargeFixture();

    const stale = expectCompactPage(fixture, ["stale", "--json"], "repos", 30);
    expect(stale.repos[0].path).toBeUndefined();
    expect(stale.repos[0].name.length).toBeLessThanOrEqual(120);

    expectCompactPage(fixture, ["who", "aggregate@example.com", "--json"], "repos", 60);
    const diff = expectCompactPage(fixture, ["diff-stats", "--week", "--json"], "repos", 30);
    expect(diff.repos[0].authors.length).toBeLessThanOrEqual(5);

    for (const command of ["dirty", "unpushed", "behind"] as const) {
      const page = expectCompactPage(fixture, [command, "--json"], "repos", 60);
      expect(page.repos[0].repo_path).toBeUndefined();
    }

    expectCompactPage(fixture, ["graph", "deps", fixture.rootRepoName, "--json"], "dependencies", 30);
    const authors = expectCompactPage(fixture, ["graph", "authors", "--json"], "authors", 30);
    expect(authors.authors[0].author_email.length).toBeLessThanOrEqual(160);
    expect(authors.authors[0].orgs.length).toBeLessThanOrEqual(8);
  }, 30_000);

  test("applies machine limits and cursor continuation while full/all preserve exhaustive legacy arrays", () => {
    const fixture = seedLargeFixture();

    const first = JSON.parse(runCli(fixture, ["stale", "--json", "--limit", "7"]).stdout) as any;
    expect(first).toMatchObject({ count: 7, total: 30, next_cursor: 7, has_more: true });
    const second = JSON.parse(runCli(fixture, ["stale", "--json", "--limit", "7", "--cursor", "7"]).stdout) as any;
    expect(second).toMatchObject({ count: 7, total: 30, cursor: 7, next_cursor: 14, has_more: true });
    expect(second.repos[0].id).not.toBe(first.repos[0].id);

    for (const escape of ["--full", "--all"]) {
      const stdout = runCli(fixture, ["stale", "--json", escape]).stdout;
      const legacy = JSON.parse(stdout) as Array<{ path: string }>;
      expect(legacy).toHaveLength(30);
      expect(legacy[0]!.path).toContain("nested-path-segment");
      expect(stdout).toContain("\n  {");
    }
  }, 30_000);
});
