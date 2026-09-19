import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, getDb } from "../db/database.js";
import { bulkInsertIssues, upsertRepo } from "../db/repos.js";
import { AGGREGATE_CURSOR_VERSION, AGGREGATE_JSON_MAX_BYTES } from "./aggregate-output.js";

/**
 * `repos issues` / `repos sync-issues` CLI tests.
 *
 * The verbs are exercised as real subprocesses against an isolated registry DB
 * with a fake `gh` on PATH, so no live GitHub call is made. These are the
 * end-to-end arms of the guard fixtures: the degraded run must not read as
 * "0 new", and the guards must hold through the CLI, not only in unit tests.
 */

let tempDir = "";
let binDir = "";
let dbPath = "";

function runCli(args: string[], extraEnv: Record<string, string> = {}) {
  return Bun.spawnSync({
    cmd: ["bun", "run", "src/cli/index.tsx", ...args],
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      HASNA_REPOS_AUTO_BOOTSTRAP: "0",
      NO_COLOR: "1",
      HASNA_REPOS_DB_PATH: dbPath,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      ...extraEnv,
    },
  });
}

const ISSUE_NODE = `{"number":7,"title":"fix the thing","state":"OPEN","stateReason":null,`
  + `"createdAt":"2026-09-10T00:00:00Z","updatedAt":"2026-09-10T00:00:00Z","closedAt":null,`
  + `"url":"https://github.com/hasna/apps/issues/7","author":{"login":"andrei-hasna"}}`;

const CLEAN_PAGE = `{"data":{"repository":{"issues":{"totalCount":1,`
  + `"pageInfo":{"hasNextPage":false,"endCursor":"c1"},"nodes":[${ISSUE_NODE}]}}}}`;

/** Real `gh api graphql` exits non-zero for an error-carrying body it still prints. */
const ERROR_PAGE = `{"data":{"repository":{"issues":{"totalCount":1,`
  + `"pageInfo":{"hasNextPage":true,"endCursor":"c1"},"nodes":[${ISSUE_NODE}]}}},`
  + `"errors":[{"message":"Something went wrong"}]}`;

function writeFakeGh(body: string, exitCode = 0) {
  writeFileSync(join(binDir, "gh"), `#!/usr/bin/env bash
cat <<'EOF'
${body}
EOF
exit ${exitCode}
`);
  chmodSync(join(binDir, "gh"), 0o755);
}

function seedRepo() {
  getDb(dbPath);
  const repo = upsertRepo({
    path: join(tempDir, "nowhere", "hasna-apps"),
    name: "apps",
    org: "hasna",
    remote_url: "github.com/hasna/apps",
  });
  closeDb();
  return repo;
}

function seedIssues(count: number) {
  const repo = seedRepo();
  getDb(dbPath);
  const base = Date.UTC(2026, 0, 1);
  bulkInsertIssues(Array.from({ length: count }, (_, index) => ({
    repo_id: repo.id,
    number: index + 1,
    title: `issue ${String(index + 1).padStart(3, "0")} ${"large-title-".repeat(30)}`,
    state: "open" as const,
    author: `author-${index % 5}`,
    created_at: new Date(base + index * 60_000).toISOString(),
    updated_at: new Date(base + index * 60_000).toISOString(),
    url: `https://github.com/hasna/apps/issues/${index + 1}`,
  })));
  closeDb();
  return repo;
}

beforeEach(() => {
  tempDir = join(tmpdir(), `repos-cli-issues-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  binDir = join(tempDir, "bin");
  dbPath = join(tempDir, "repos.db");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(join(tempDir, "nowhere"), { recursive: true });
});

afterEach(() => {
  closeDb();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("repos issues CLI verb", () => {
  test("--help smoke: lists the verb and every option", () => {
    const result = runCli(["issues", "--help"]);
    const stdout = new TextDecoder().decode(result.stdout);
    const stderr = new TextDecoder().decode(result.stderr);
    expect(result.exitCode, stderr).toBe(0);
    for (const token of [
      "issues",
      "--repo",
      "--org",
      "--repo-name",
      "--state",
      "--author",
      "--duplicates",
      "-n, --limit",
      "--cursor",
      "--full",
      "--all",
      "--verbose",
      "--json",
    ]) {
      expect(stdout, `missing ${token}`).toContain(token);
    }
  });

  test("lists synced issues and de-duplicates by issue, not by checkout", () => {
    seedRepo();
    writeFakeGh(CLEAN_PAGE);
    closeDb();

    const synced = runCli(["sync-issues", "--repo", "apps", "--json"]);
    expect(synced.exitCode, new TextDecoder().decode(synced.stderr)).toBe(0);

    const listed = runCli(["issues", "--json"]);
    const stdout = new TextDecoder().decode(listed.stdout);
    expect(listed.exitCode, new TextDecoder().decode(listed.stderr)).toBe(0);
    const page = JSON.parse(stdout);
    expect(page).toMatchObject({
      count: 1,
      total: 1,
      limit: 20,
      cursor: null,
      next_cursor: null,
      has_more: false,
      complete: true,
      compact: true,
      cursor_version: AGGREGATE_CURSOR_VERSION,
    });
    expect(page.issues).toHaveLength(1);
    expect(page.issues[0]).toMatchObject({
      number: 7,
      state: "open",
      org: "hasna",
      repo: "apps",
      repo_id: expect.any(Number),
      issue_key: expect.stringMatching(/^issue:[0-9a-f]{24}$/),
      issue_ref: "hasna/apps#7",
    });
  });

  test("compact duplicate-checkout rows share issue identity but retain distinct repository identity", () => {
    const db = getDb(dbPath);
    const primary = upsertRepo({
      path: join(tempDir, "nowhere", "primary-apps"),
      name: "apps-primary",
      org: "hasna",
      remote_url: "github.com/hasna/apps",
    });
    const secondary = upsertRepo({
      path: join(tempDir, "nowhere", "secondary-apps"),
      name: "apps-secondary",
      org: "hasna",
      remote_url: "github.com/hasna/apps",
    });
    bulkInsertIssues([primary, secondary].map((repo) => ({
      repo_id: repo.id,
      number: 42,
      title: "same issue from two checkouts",
      state: "open" as const,
      author: "duplicate-author",
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:00.000Z",
      url: "https://github.com/hasna/apps/issues/42",
    })));
    closeDb();

    const deduped = JSON.parse(new TextDecoder().decode(runCli(["issues", "--json"]).stdout));
    expect(deduped.count).toBe(1);
    expect(deduped.total).toBe(1);

    const duplicatePage = JSON.parse(new TextDecoder().decode(runCli(["issues", "--duplicates", "--json"]).stdout));
    expect(duplicatePage.count).toBe(2);
    expect(duplicatePage.total).toBe(2);
    expect(new Set(duplicatePage.issues.map((issue: any) => issue.issue_key)).size).toBe(1);
    expect(new Set(duplicatePage.issues.map((issue: any) => issue.issue_ref)).size).toBe(1);
    expect(new Set(duplicatePage.issues.map((issue: any) => issue.issue_id)).size).toBe(2);
    expect(new Set(duplicatePage.issues.map((issue: any) => issue.repo_id)).size).toBe(2);
  });

  test("large JSON output is compact, minified, byte-bounded, and opaque-cursor paged", () => {
    seedIssues(75);

    const firstResult = runCli(["issues", "--json"]);
    const firstStdout = new TextDecoder().decode(firstResult.stdout);
    expect(firstResult.exitCode, new TextDecoder().decode(firstResult.stderr)).toBe(0);
    expect(Buffer.byteLength(firstStdout, "utf8")).toBeLessThanOrEqual(AGGREGATE_JSON_MAX_BYTES);
    expect(firstStdout.trimEnd()).not.toContain("\n");
    const first = JSON.parse(firstStdout);
    expect(first).toMatchObject({
      count: 20,
      total: 75,
      limit: 20,
      cursor: null,
      has_more: true,
      complete: false,
      compact: true,
      byte_limit: AGGREGATE_JSON_MAX_BYTES,
      cursor_version: AGGREGATE_CURSOR_VERSION,
    });
    expect(typeof first.next_cursor).toBe("string");
    expect(first.next_cursor.length).toBeGreaterThan(20);
    expect(first.issues).toHaveLength(20);
    for (const issue of first.issues) {
      expect(issue).toMatchObject({
        issue_id: expect.any(Number),
        issue_key: expect.any(String),
        issue_ref: expect.any(String),
        repo_id: expect.any(Number),
        org: "hasna",
        repo: "apps",
        number: expect.any(Number),
      });
      expect(issue.title.length).toBeLessThanOrEqual(140);
      expect(issue.url).toBeUndefined();
    }

    const secondResult = runCli(["issues", "--json", "--cursor", first.next_cursor]);
    expect(secondResult.exitCode, new TextDecoder().decode(secondResult.stderr)).toBe(0);
    const second = JSON.parse(new TextDecoder().decode(secondResult.stdout));
    expect(second.cursor).toBe(first.next_cursor);
    expect(second.count).toBe(20);
    expect(second.total).toBe(75);
    expect(new Set([...first.issues, ...second.issues].map((issue) => issue.issue_key)).size).toBe(40);

    const fullResult = runCli(["issues", "--json", "--full"]);
    const fullStdout = new TextDecoder().decode(fullResult.stdout);
    expect(fullResult.exitCode, new TextDecoder().decode(fullResult.stderr)).toBe(0);
    const full = JSON.parse(fullStdout);
    expect(full).toHaveLength(75);
    expect(full[0].url).toContain("/issues/");
    expect(fullStdout).toContain("\n  {");
    const all = JSON.parse(new TextDecoder().decode(runCli(["issues", "--json", "--all"]).stdout));
    expect(all).toEqual(full);
  });

  test("issue cursors fail closed on inserts, query changes, and numeric offsets", () => {
    const repo = seedIssues(30);
    const firstResult = runCli(["issues", "--json", "--limit", "7"]);
    const first = JSON.parse(new TextDecoder().decode(firstResult.stdout));

    getDb(dbPath);
    bulkInsertIssues([{
      repo_id: repo.id,
      number: 999,
      title: "inserted after page one",
      state: "open",
      author: "mutation-author",
      created_at: "2026-12-31T23:59:59.000Z",
      updated_at: "2026-12-31T23:59:59.000Z",
      url: "https://github.com/hasna/apps/issues/999",
    }]);
    closeDb();

    const mutated = runCli(["issues", "--json", "--limit", "7", "--cursor", first.next_cursor]);
    expect(mutated.exitCode).toBe(1);
    expect(new TextDecoder().decode(mutated.stdout)).toBe("");
    expect(new TextDecoder().decode(mutated.stderr)).toContain("aggregate cursor snapshot no longer matches");

    const wrongQuery = runCli(["issues", "--state", "closed", "--json", "--cursor", first.next_cursor]);
    expect(wrongQuery.exitCode).toBe(1);
    expect(new TextDecoder().decode(wrongQuery.stderr)).toContain("aggregate cursor does not match this command, filters, or ordering");

    const numeric = runCli(["issues", "--json", "--cursor", "7"]);
    expect(numeric.exitCode).toBe(1);
    expect(new TextDecoder().decode(numeric.stderr)).toContain("invalid aggregate cursor");
  });

  test("issue cursors fail closed on delete and reorder mutations", () => {
    const repo = seedIssues(30);
    const first = JSON.parse(new TextDecoder().decode(runCli(["issues", "--json", "--limit", "7"]).stdout));

    const db = getDb(dbPath);
    db.query("DELETE FROM issues WHERE repo_id = ? AND number = ?").run(repo.id, 1);
    closeDb();
    const deleted = runCli(["issues", "--json", "--limit", "7", "--cursor", first.next_cursor]);
    expect(deleted.exitCode).toBe(1);
    expect(new TextDecoder().decode(deleted.stderr)).toContain("aggregate cursor snapshot no longer matches");

    const afterDelete = JSON.parse(new TextDecoder().decode(runCli(["issues", "--json", "--limit", "7"]).stdout));
    getDb(dbPath);
    bulkInsertIssues([{
      repo_id: repo.id,
      number: 2,
      title: "reordered existing issue",
      state: "open",
      author: "author-1",
      created_at: "2026-12-30T00:00:00.000Z",
      updated_at: "2026-12-30T00:00:00.000Z",
      url: "https://github.com/hasna/apps/issues/2",
    }]);
    closeDb();
    const reordered = runCli(["issues", "--json", "--limit", "7", "--cursor", afterDelete.next_cursor]);
    expect(reordered.exitCode).toBe(1);
    expect(new TextDecoder().decode(reordered.stderr)).toContain("aggregate cursor snapshot no longer matches");
  });

  test("the first complete run is a baseline; a later quiet run may say 0 new", () => {
    seedRepo();
    writeFakeGh(CLEAN_PAGE);
    closeDb();

    const first = runCli(["sync-issues", "--repo", "apps"]);
    const firstOut = new TextDecoder().decode(first.stdout);
    expect(first.exitCode, new TextDecoder().decode(first.stderr)).toBe(0);
    expect(firstOut).toContain("baseline");
    expect(firstOut).not.toContain("0 new");

    const second = runCli(["sync-issues", "--repo", "apps"]);
    const secondOut = new TextDecoder().decode(second.stdout);
    expect(second.exitCode, new TextDecoder().decode(second.stderr)).toBe(0);
    expect(secondOut).toContain("0 new");
  });

  test("a degraded run reports incomplete[] and never renders as 0 new", () => {
    seedRepo();
    writeFakeGh(ERROR_PAGE, 1);
    closeDb();

    const result = runCli(["sync-issues", "--repo", "apps", "--json"]);
    const stdout = new TextDecoder().decode(result.stdout);
    const stderr = new TextDecoder().decode(result.stderr);
    // Degraded is an operator-visible failure, not a quiet success.
    expect(result.exitCode, stderr).toBe(1);
    const envelope = JSON.parse(stdout);
    expect(envelope.sealed).toBe(false);
    expect(envelope.watermark_advanced).toBe(false);
    expect(envelope.watermark).toBeNull();
    expect(envelope.incomplete).toHaveLength(1);
    expect(envelope.incomplete[0].repo).toBe("hasna/apps");
    expect(envelope.incomplete[0].reason).toBe("page_transient");

    const human = runCli(["sync-issues", "--repo", "apps"]);
    const humanOut = new TextDecoder().decode(human.stdout);
    expect(human.exitCode).toBe(1);
    expect(humanOut).toContain("degraded");
    expect(humanOut).not.toContain("0 new");
  });

  test("a rate-limited run stops and reports it without claiming a result", () => {
    seedRepo();
    writeFakeGh(`{"data":null,"errors":[{"message":"API rate limit exceeded for user ID 1."}]}`, 1);
    closeDb();

    const result = runCli(["sync-issues", "--org", "hasna"]);
    const stdout = new TextDecoder().decode(result.stdout);
    expect(result.exitCode).toBe(1);
    expect(stdout).toContain("degraded");
    expect(stdout).not.toContain("0 new");
  });
});
