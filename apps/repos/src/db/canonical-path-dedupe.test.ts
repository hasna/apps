/**
 * Regression tests for the double-index bug (todos 9c888b88, measured
 * 2026-08-14): on a case-insensitive filesystem (macOS APFS) `~/workspace`
 * and `~/Workspace` are the SAME directory, and scanning both bootstrap roots
 * indexed every checkout twice — `repos repo <name>` then threw
 * AmbiguousRepoNameError for a name with exactly one real checkout.
 *
 * The fixtures register one directory under two path spellings and assert
 * that one row survives and the lookup resolves uniquely on a
 * case-insensitive filesystem, while on a case-sensitive filesystem the
 * same operation leaves two genuinely distinct paths untouched.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { closeDb, getDb } from "./database.js";
import { getRepo, mergeCanonicalDuplicateRepos, upsertRepo } from "./repos.js";
import { scanRepos } from "../lib/scanner.js";

const TEST_DIR = realpathSync(mkdtempSync(join(tmpdir(), "repos-canonical-test-")));

function createGitRepo(name: string): string {
  const repoPath = join(TEST_DIR, name);
  mkdirSync(repoPath, { recursive: true });
  execSync(`git init`, { cwd: repoPath, stdio: "pipe" });
  execSync(`git config user.email "test@test.com"`, { cwd: repoPath, stdio: "pipe" });
  execSync(`git config user.name "Test User"`, { cwd: repoPath, stdio: "pipe" });
  writeFileSync(join(repoPath, "file.txt"), "content");
  execSync(`git add .`, { cwd: repoPath, stdio: "pipe" });
  execSync(`git commit -m "commit 0"`, { cwd: repoPath, stdio: "pipe" });
  return repoPath;
}

/** A case-variant spelling of the SAME directory name (same parent). */
function caseVariant(path: string): string {
  return join(dirname(path), basename(path).toUpperCase());
}

/**
 * True when the filesystem resolves case-variant spellings of an existing
 * directory to one directory (macOS APFS, default Windows volumes). On a
 * case-sensitive filesystem the variant does not resolve at all.
 */
function filesystemCaseInsensitive(root: string): boolean {
  const probe = join(root, `case-probe-${process.pid}`);
  mkdirSync(probe, { recursive: true });
  let same = false;
  try {
    same = realpathSync(probe) === realpathSync(join(root, basename(probe).toUpperCase()));
  } catch {
    same = false;
  }
  rmSync(probe, { recursive: true, force: true });
  return same;
}

beforeEach(() => {
  closeDb();
  process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
  getDb(":memory:");
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  closeDb();
});

afterAll(() => {
  closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env["HASNA_REPOS_DB_PATH"];
});

describe("upsertRepo canonical identity", () => {
  test("collapses a case-variant twin of one directory on a case-insensitive filesystem", () => {
    const caseInsensitive = filesystemCaseInsensitive(TEST_DIR);
    const repoPath = createGitRepo("upsert-twin");
    const first = upsertRepo({ path: repoPath, name: "upsert-twin" });
    upsertRepo({ path: caseVariant(repoPath), name: "upsert-twin" });

    const rows = getDb().query("SELECT id, path FROM repos ORDER BY id").all() as Array<{ id: number; path: string }>;
    if (caseInsensitive) {
      // Two spellings of one directory must be ONE row, stored under the
      // on-disk spelling, and the by-name lookup must resolve uniquely.
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(first.id);
      expect(rows[0]!.path).toBe(realpathSync(repoPath));
      expect(getRepo("upsert-twin")?.id).toBe(first.id);
    } else {
      // Case-sensitive: the variant names a different path (or nothing at
      // all) and must stay its own row — behavior unchanged.
      expect(rows).toHaveLength(2);
    }
  });

  test("never treats two nonexistent case-variants as one directory", () => {
    // The identity must come from the filesystem. Two spellings of a path
    // that does not exist are NOT the same directory on any filesystem, so
    // they stay distinct rows here — on a case-insensitive volume this is
    // what keeps the merge from inventing collisions for missing checkouts.
    const first = upsertRepo({ path: join(TEST_DIR, "gone", "Repo"), name: "gone" });
    const second = upsertRepo({ path: join(TEST_DIR, "gone", "REPO"), name: "gone" });
    expect(second.id).not.toBe(first.id);
    const rows = getDb().query("SELECT id FROM repos ORDER BY id").all() as Array<{ id: number }>;
    expect(rows).toHaveLength(2);
  });
});

describe("mergeCanonicalDuplicateRepos", () => {
  test("merges seeded double rows, keeps the first, and re-points references", () => {
    const caseInsensitive = filesystemCaseInsensitive(TEST_DIR);
    const dir = createGitRepo("merge-target");
    const canonical = realpathSync(dir);
    const variant = caseVariant(dir);
    const db = getDb();
    db.query("INSERT INTO repos (path, name) VALUES (?, ?)").run(canonical, "merge-target");
    db.query("INSERT INTO repos (path, name) VALUES (?, ?)").run(variant, "merge-target");
    const [survivorRow, dupRow] = db.query("SELECT id, path FROM repos ORDER BY id").all() as Array<{ id: number; path: string }>;

    // Children split across both rows: same branch name on each, a tag and a
    // commit only on the duplicate, the same pull request on both.
    db.query("INSERT INTO branches (repo_id, name, is_remote, last_commit_sha) VALUES (?, 'main', 0, 'aaa')").run(survivorRow.id);
    db.query("INSERT INTO branches (repo_id, name, is_remote, last_commit_sha) VALUES (?, 'main', 0, 'bbb')").run(dupRow.id);
    db.query("INSERT INTO tags (repo_id, name, sha) VALUES (?, 'v1', 'ccc')").run(dupRow.id);
    db.query("INSERT INTO commits (repo_id, sha, author_name, author_email, date, message) VALUES (?, 'dddd', 't', 't@t.com', '2026-01-01', 'm')").run(dupRow.id);
    db.query("INSERT INTO pull_requests (repo_id, number, title, state, author, created_at) VALUES (?, 1, 't', 'open', 'a', '2026-01-01')").run(survivorRow.id);
    db.query("INSERT INTO pull_requests (repo_id, number, title, state, author, created_at) VALUES (?, 1, 't', 'open', 'a', '2026-01-01')").run(dupRow.id);
    // A worktree lease pointing at the duplicate row through every reference.
    db.query(`INSERT INTO worktree_leases (
        lease_id, repo_id, repo_path, repo_catalog_id, machine_id, worktree_path,
        branch, base_ref, base_sha, task_id, run_id, mode, owner_metadata,
        cleanup_policy, status, created_at, updated_at, claimed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', 'delete-if-clean', 'claimed', '2026-01-01', '2026-01-01', '2026-01-01')`)
      .run("lease-1", `path:${dupRow.path}`, dupRow.path, dupRow.id, "machine-1", "/tmp/wt", "task-b", "main", "eeee", "task-1", "run-1", "task");

    const result = mergeCanonicalDuplicateRepos({ db });
    const rowsAfter = db.query("SELECT id, path FROM repos ORDER BY id").all() as Array<{ id: number; path: string }>;

    if (!caseInsensitive) {
      // The variant is a genuinely different path (or does not exist): never
      // merged, nothing moved, nothing deleted.
      expect(result.duplicate_rows_removed).toBe(0);
      expect(rowsAfter).toHaveLength(2);
      return;
    }

    expect(result.duplicate_rows_removed).toBe(1);
    expect(rowsAfter).toHaveLength(1);
    expect(rowsAfter[0]!.id).toBe(survivorRow.id);
    expect(rowsAfter[0]!.path).toBe(canonical);

    // The duplicate's children moved onto the survivor; where both rows had
    // the same child, the survivor's copy won.
    expect(db.query("SELECT repo_id, last_commit_sha FROM branches").all()).toEqual([
      { repo_id: survivorRow.id, last_commit_sha: "aaa" },
    ]);
    expect(db.query("SELECT repo_id, sha FROM tags").all()).toEqual([{ repo_id: survivorRow.id, sha: "ccc" }]);
    expect(db.query("SELECT repo_id, sha FROM commits").all()).toEqual([{ repo_id: survivorRow.id, sha: "dddd" }]);
    expect(db.query("SELECT repo_id, number FROM pull_requests").all()).toEqual([
      { repo_id: survivorRow.id, number: 1 },
    ]);

    // The lease follows the survivor instead of being SET NULL.
    const lease = db.query(
      "SELECT repo_id, repo_path, repo_catalog_id FROM worktree_leases WHERE lease_id = 'lease-1'",
    ).get() as { repo_id: string; repo_path: string; repo_catalog_id: number };
    expect(lease.repo_catalog_id).toBe(survivorRow.id);
    expect(lease.repo_path).toBe(canonical);
    expect(lease.repo_id).toBe(`path:${canonical}`);

    // The exact failure this bug produced: the by-name lookup must resolve.
    expect(getRepo("merge-target")?.id).toBe(survivorRow.id);
  });
});

describe("scan end-to-end", () => {
  test("merges pre-existing double rows so the repo lookup resolves uniquely", async () => {
    const caseInsensitive = filesystemCaseInsensitive(TEST_DIR);
    const repoPath = createGitRepo("scan-merge-target");
    const canonical = realpathSync(repoPath);
    const db = getDb();
    db.query("INSERT INTO repos (path, name) VALUES (?, ?)").run(canonical, "scan-merge-target");
    db.query("INSERT INTO repos (path, name) VALUES (?, ?)").run(caseVariant(repoPath), "scan-merge-target");

    const result = await scanRepos([TEST_DIR]);
    const rows = db.query("SELECT id, path FROM repos ORDER BY id").all() as Array<{ id: number; path: string }>;

    if (caseInsensitive) {
      expect(result.duplicate_rows_merged).toBe(1);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.path).toBe(canonical);
      expect(() => getRepo("scan-merge-target")).not.toThrow();
      expect(getRepo("scan-merge-target")?.id).toBe(rows[0]!.id);
    } else {
      expect(result.duplicate_rows_merged).toBe(0);
      expect(rows).toHaveLength(2);
    }
  });

  test("scanning two spellings of one root directory discovers each repo once", async () => {
    createGitRepo("single-index");
    const result = await scanRepos([join(TEST_DIR, "single-index"), caseVariant(join(TEST_DIR, "single-index"))]);
    expect(result.repos_found).toBe(1);
    expect(result.repos_new).toBe(1);
    expect(getDb().query("SELECT COUNT(*) AS c FROM repos").get()).toEqual({ c: 1 });
  });

  test("scanning case-variant roots of the same tree does not double-index", async () => {
    createGitRepo("tree/apps");
    const result = await scanRepos([join(TEST_DIR, "tree"), caseVariant(join(TEST_DIR, "tree"))]);
    expect(result.repos_found).toBe(1);
    expect(result.repos_new).toBe(1);
    expect(getDb().query("SELECT COUNT(*) AS c FROM repos").get()).toEqual({ c: 1 });
  });
});
