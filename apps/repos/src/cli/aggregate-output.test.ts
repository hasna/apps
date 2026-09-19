import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { closeDb, getDb } from "../db/database.js";
import { bulkInsertCommits, upsertRepo } from "../db/repos.js";
import {
  AGGREGATE_CURSOR_VERSION,
  AGGREGATE_JSON_MAX_BYTES,
  AggregateCursorError,
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

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
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

  // Same-name repositories are legal across organizations. Their compact rows
  // must remain distinguishable without disclosing the path.
  for (const [offset, org] of ["duplicate-alpha", "duplicate-beta"].entries()) {
    const name = "duplicate-repository";
    const repo = upsertRepo({
      path: `/workspace/repositories/${longPathSegment}/${org}/${name}`,
      name,
      org,
      remote_url: `github.com/${org}/${name}`,
      default_branch: "main",
      commit_count: 1,
      branch_count: 1,
      tag_count: 0,
    });
    repos.push({ id: repo.id, name });
    commits.push({
      repo_id: repo.id,
      sha: `${(60 + offset).toString(16).padStart(40, "0")}`,
      author_name: "Duplicate Name Author",
      author_email: "aggregate@example.com",
      date: recent,
      message: `duplicate-name fixture ${offset}`,
      files_changed: 1,
      insertions: 1,
      deletions: 0,
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
    insertEdge.run("author", email, "works_in", "org", `org-${index}-alpha-${"wide-".repeat(14)}`, 1);
    insertEdge.run("author", email, "works_in", "org", `org-${index}-beta-${"wide-".repeat(14)}`, 1);
  }

  closeDb();
  delete process.env["HASNA_REPOS_DB_PATH"];
  return { dbPath, binPath, rootRepoName: rootRepo.name };
}

function spawnCli(fixture: Fixture, args: string[]): CliResult {
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
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function runCli(fixture: Fixture, args: string[]): { stdout: string; stderr: string } {
  const result = spawnCli(fixture, args);
  expect(result.exitCode, result.stderr).toBe(0);
  return result;
}

function expectStableRepoRows(rows: Array<Record<string, any>>): void {
  const ids = rows.map((row) => Number(row.repo_id));
  expect(ids).toEqual([...ids].sort((left, right) => left - right));
  for (const row of rows) {
    expect(row.repo_id).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(row, "org")).toBe(true);
    expect(typeof row.repo_ref).toBe("string");
    expect(row.repo_ref.length).toBeGreaterThan(0);
    expect(row.repo_path).toBeUndefined();
  }
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
    cursor: null,
    has_more: true,
    complete: false,
    compact: true,
    byte_limit: AGGREGATE_JSON_MAX_BYTES,
    cursor_version: AGGREGATE_CURSOR_VERSION,
  });
  expect(typeof page.next_cursor).toBe("string");
  expect(page.next_cursor.length).toBeGreaterThan(20);
  expect(page[collection]).toHaveLength(20);
  return page;
}

function allPages(
  fixture: Fixture,
  args: string[],
  collection: "repos" | "dependencies" | "authors",
): Array<Record<string, any>> {
  const rows: Array<Record<string, any>> = [];
  let cursor: string | null = null;
  do {
    const pageArgs = [...args, "--json", "--limit", "20", ...(cursor ? ["--cursor", cursor] : [])];
    const page = JSON.parse(runCli(fixture, pageArgs).stdout) as Record<string, any>;
    rows.push(...page[collection]);
    cursor = page.next_cursor;
  } while (cursor);
  return rows;
}

afterEach(() => {
  closeDb();
  delete process.env["HASNA_REPOS_DB_PATH"];
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("aggregate JSON paging helper", () => {
  const baseItems = Array.from({ length: 8 }, (_, index) => ({ id: index, value: `row-${index}` }));
  const baseOptions = {
    collection: "items",
    command: "fixture",
    filters: { scope: "all" },
    ordering: "id-asc",
    limit: 3,
    project: (item: { id: number; value: string }) => item,
  } as const;

  test("enforces a whole-envelope UTF-8 ceiling and advances by rows actually returned", () => {
    const items = Array.from({ length: 80 }, (_, index) => ({
      id: index,
      path: `/${"deep/".repeat(100)}row-${index}`,
    }));
    const page = buildAggregatePage({
      collection: "items",
      command: "byte-fixture",
      filters: {},
      ordering: "id-asc",
      items,
      limit: 20,
      maxBytes: 2_048,
      project: (item) => item,
    });

    expect(page.count).toBeGreaterThan(0);
    expect(page.count).toBeLessThan(20);
    expect(typeof page.next_cursor).toBe("string");
    expect(page.has_more).toBe(true);
    expect(aggregatePageBytes(page)).toBeLessThanOrEqual(2_048);
  });

  test("continues an unchanged snapshot without duplicate rows", () => {
    const first = buildAggregatePage({ ...baseOptions, items: baseItems });
    const second = buildAggregatePage({ ...baseOptions, items: baseItems, cursor: first.next_cursor });
    expect(first.items).toEqual(baseItems.slice(0, 3));
    expect(second.items).toEqual(baseItems.slice(3, 6));
    expect(new Set([...(first.items as any[]), ...(second.items as any[])].map((row) => row.id)).size).toBe(6);
  });

  test("fails closed on inserts, deletes, reordering, and context changes", () => {
    const first = buildAggregatePage({ ...baseOptions, items: baseItems });
    const cursor = first.next_cursor!;
    const inserted = [{ id: -1, value: "inserted" }, ...baseItems];
    const deleted = baseItems.slice(1);
    const reordered = [baseItems[1]!, baseItems[0]!, ...baseItems.slice(2)];
    const projectedMutation = baseItems.map((item) =>
      item.id === 5 ? { ...item, value: "changed-without-reordering" } : item
    );

    for (const items of [inserted, deleted, reordered, projectedMutation]) {
      expect(() => buildAggregatePage({ ...baseOptions, items, cursor }))
        .toThrow("aggregate cursor snapshot no longer matches");
    }
    expect(() => buildAggregatePage({ ...baseOptions, command: "another-command", items: baseItems, cursor }))
      .toThrow("aggregate cursor does not match");
    expect(() => buildAggregatePage({ ...baseOptions, filters: { scope: "other" }, items: baseItems, cursor }))
      .toThrow("aggregate cursor does not match");
    expect(() => buildAggregatePage({ ...baseOptions, ordering: "id-desc", items: baseItems, cursor }))
      .toThrow("aggregate cursor does not match");
    expect(() => buildAggregatePage({ ...baseOptions, items: baseItems, cursor: "7" }))
      .toThrow(AggregateCursorError);
  });

  test("advances duplicate projected anchors by occurrence without duplicate or skipped pages", () => {
    const duplicateItems = [
      { id: 1, value: "same" },
      { id: 2, value: "same" },
      { id: 3, value: "same" },
    ];
    const options = {
      collection: "items",
      command: "duplicate-anchor-fixture",
      filters: {},
      ordering: "id-asc",
      items: duplicateItems,
      limit: 1,
      project: (item: { id: number; value: string }) => ({ value: item.value }),
    } as const;
    const first = buildAggregatePage(options);
    const second = buildAggregatePage({ ...options, cursor: first.next_cursor });
    const third = buildAggregatePage({ ...options, cursor: second.next_cursor });
    const firstPayload = JSON.parse(Buffer.from(first.next_cursor!, "base64url").toString("utf8"));
    const secondPayload = JSON.parse(Buffer.from(second.next_cursor!, "base64url").toString("utf8"));

    expect(firstPayload.a).toBe(secondPayload.a);
    expect(firstPayload.c).toBe(1);
    expect(secondPayload.c).toBe(2);
    expect(first.count).toBe(1);
    expect(second.count).toBe(1);
    expect(third.count).toBe(1);
    expect(third.next_cursor).toBeNull();
    expect(third.complete).toBe(true);
  });

  test("rejects empty and oversized cursor bounds instead of restarting", () => {
    expect(() => buildAggregatePage({ ...baseOptions, items: baseItems, cursor: "" }))
      .toThrow("invalid aggregate cursor encoding");
    expect(() => buildAggregatePage({ ...baseOptions, items: baseItems, cursor: "a".repeat(513) }))
      .toThrow("invalid aggregate cursor encoding");
  });

  test("rejects a structurally valid cursor whose anchor or occurrence was forged", () => {
    const first = buildAggregatePage({ ...baseOptions, items: baseItems });
    const decoded = JSON.parse(Buffer.from(first.next_cursor!, "base64url").toString("utf8"));
    expect(decoded.o).toBeUndefined();

    for (const patch of [{ a: "forged-anchor" }, { c: decoded.c + 1 }]) {
      const forged = Buffer.from(JSON.stringify({ ...decoded, ...patch }), "utf8").toString("base64url");
      expect(() => buildAggregatePage({ ...baseOptions, items: baseItems, cursor: forged }))
        .toThrow("aggregate cursor integrity check failed");
    }
  });
});

describe("secondary aggregate CLI JSON", () => {
  test("defaults every aggregate to a stable 20-row compact minified continuation page", () => {
    const fixture = seedLargeFixture();

    const stale = expectCompactPage(fixture, ["stale", "--json"], "repos", 30);
    expect(stale.repos[0].name.length).toBeLessThanOrEqual(120);
    expectStableRepoRows(stale.repos);

    const who = expectCompactPage(fixture, ["who", "aggregate@example.com", "--json"], "repos", 62);
    expectStableRepoRows(who.repos);
    const diff = expectCompactPage(fixture, ["diff-stats", "--week", "--json"], "repos", 32);
    expect(diff.repos[0].authors.length).toBeLessThanOrEqual(5);
    expectStableRepoRows(diff.repos);

    for (const command of ["dirty", "unpushed", "behind"] as const) {
      const page = expectCompactPage(fixture, [command, "--json"], "repos", 62);
      expectStableRepoRows(page.repos);
    }

    const deps = expectCompactPage(fixture, ["graph", "deps", fixture.rootRepoName, "--json"], "dependencies", 30);
    expectStableRepoRows(deps.dependencies);
    const authors = expectCompactPage(fixture, ["graph", "authors", "--json"], "authors", 30);
    expect(authors.authors[0].author_email.length).toBeLessThanOrEqual(160);
    expect(authors.authors[0].orgs.length).toBeLessThanOrEqual(8);
    const authorEmails = authors.authors.map((author: any) => author.author_email);
    expect(authorEmails).toEqual([...authorEmails].sort());
  }, 30_000);

  test("uses deterministic secondary ordering and distinguishes same-name repositories", () => {
    const fixture = seedLargeFixture();
    const rows = allPages(fixture, ["who", "aggregate@example.com"], "repos");
    expect(rows).toHaveLength(62);
    expect(rows.map((row) => row.repo_id)).toEqual([...rows.map((row) => row.repo_id)].sort((a, b) => a - b));
    expect(new Set(rows.map((row) => row.repo_id)).size).toBe(rows.length);

    const duplicates = rows.filter((row) => row.repo_name === "duplicate-repository");
    expect(duplicates).toHaveLength(2);
    expect(new Set(duplicates.map((row) => row.repo_id)).size).toBe(2);
    expect(new Set(duplicates.map((row) => row.org)).size).toBe(2);
    expect(new Set(duplicates.map((row) => row.repo_ref)).size).toBe(2);
  }, 30_000);

  test("applies machine limits and opaque continuation while preserving exhaustive legacy arrays", () => {
    const fixture = seedLargeFixture();

    const first = JSON.parse(runCli(fixture, ["stale", "--json", "--limit", "7"]).stdout) as any;
    expect(first).toMatchObject({ count: 7, total: 30, cursor: null, has_more: true });
    expect(typeof first.next_cursor).toBe("string");
    const second = JSON.parse(runCli(fixture, ["stale", "--json", "--limit", "7", "--cursor", first.next_cursor]).stdout) as any;
    expect(second).toMatchObject({ count: 7, total: 30, cursor: first.next_cursor, has_more: true });
    expect(typeof second.next_cursor).toBe("string");
    expect(second.repos[0].repo_id).not.toBe(first.repos[0].repo_id);

    for (const escape of ["--full", "--all"]) {
      const stdout = runCli(fixture, ["stale", "--json", escape]).stdout;
      const legacy = JSON.parse(stdout) as Array<{ path: string }>;
      expect(legacy).toHaveLength(30);
      expect(legacy[0]!.path).toContain("nested-path-segment");
      expect(stdout).toContain("\n  {");
    }

    const dirtyLegacy = JSON.parse(runCli(fixture, ["dirty", "--json", "--full"]).stdout) as any[];
    expect(dirtyLegacy).toHaveLength(62);
    expect(dirtyLegacy[0].repo_path).toContain("nested-path-segment");
    expect(dirtyLegacy[0].repo_id).toBeUndefined();
    expect(dirtyLegacy[0].repo_org).toBeUndefined();

    const legacyCases: Array<{ args: string[]; length: number; keys: string[] }> = [
      {
        args: ["who", "aggregate@example.com", "--json", "--full"],
        length: 62,
        keys: ["commit_count", "deletions", "first_commit", "insertions", "last_commit", "repo_id", "repo_name"],
      },
      {
        args: ["diff-stats", "--week", "--json", "--full"],
        length: 32,
        keys: ["authors", "commit_count", "deletions", "insertions", "repo_name"],
      },
      {
        args: ["unpushed", "--json", "--full"],
        length: 62,
        keys: ["ahead", "branch", "repo_name", "repo_path"],
      },
      {
        args: ["behind", "--json", "--full"],
        length: 62,
        keys: ["behind", "branch", "repo_name", "repo_path"],
      },
      {
        args: ["graph", "deps", fixture.rootRepoName, "--json", "--full"],
        length: 30,
        keys: ["depth", "repo_id", "repo_name"],
      },
      {
        args: ["graph", "authors", "--json", "--full"],
        length: 30,
        keys: ["author_email", "orgs", "total_commits"],
      },
    ];
    for (const legacyCase of legacyCases) {
      const rows = JSON.parse(runCli(fixture, legacyCase.args).stdout) as any[];
      expect(rows, legacyCase.args.join(" ")).toHaveLength(legacyCase.length);
      expect(Object.keys(rows[0]!).sort(), legacyCase.args.join(" ")).toEqual(legacyCase.keys);
    }
  }, 30_000);

  test("fails closed when the population mutates between CLI pages or the filter changes", () => {
    const fixture = seedLargeFixture();
    const first = JSON.parse(runCli(fixture, ["stale", "--json", "--limit", "7"]).stdout) as any;

    closeDb();
    process.env["HASNA_REPOS_DB_PATH"] = fixture.dbPath;
    getDb(fixture.dbPath);
    upsertRepo({
      path: "/workspace/repositories/inserted-after-page-one",
      name: "inserted-after-page-one",
      org: "mutation-fixture",
      remote_url: "github.com/mutation-fixture/inserted-after-page-one",
      default_branch: "main",
    });
    closeDb();
    delete process.env["HASNA_REPOS_DB_PATH"];

    const mutated = spawnCli(fixture, ["stale", "--json", "--limit", "7", "--cursor", first.next_cursor]);
    expect(mutated.exitCode).toBe(1);
    expect(mutated.stdout).toBe("");
    expect(mutated.stderr).toContain("aggregate cursor snapshot no longer matches");

    const wrongFilter = spawnCli(fixture, ["stale", "--days", "31", "--json", "--limit", "7", "--cursor", first.next_cursor]);
    expect(wrongFilter.exitCode).toBe(1);
    expect(wrongFilter.stderr).toContain("aggregate cursor does not match this command, filters, or ordering");
  }, 30_000);
});
