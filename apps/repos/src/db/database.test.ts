import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { spawn } from "node:child_process";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, closeDb } from "./database";
import { listRepos } from "./repos";

describe("database", () => {
  beforeAll(() => {
    process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
  });

  afterAll(() => {
    closeDb();
    delete process.env["HASNA_REPOS_DB_PATH"];
  });

  it("should initialize with WAL mode (or memory for in-memory)", () => {
    const db = getDb(":memory:");
    const result = db.query("PRAGMA journal_mode").get() as any;
    // In-memory DBs use "memory" journal mode; file-backed DBs use "wal"
    expect(["wal", "memory"]).toContain(result.journal_mode);
  });

  it("rejects SQLite memory URI aliases before opening or creating an artifact", () => {
    closeDb();
    const uri = `file::memory:?cache=shared&repos_test=${process.pid}`;
    expect(() => getDb(uri)).toThrow("SQLite memory URI paths are unsupported; use exact :memory:");
    expect(existsSync(uri)).toBe(false);
    process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
    getDb(":memory:");
  });

  it("keeps parameterless SDK reads inside the active explicit database context", () => {
    closeDb();
    const previousPrimary = process.env["HASNA_REPOS_DB_PATH"];
    const previousFallback = process.env["REPOS_DB_PATH"];
    const previousRequirement = process.env["HASNA_REPOS_REQUIRE_EXPLICIT_DB_PATH"];
    delete process.env["HASNA_REPOS_DB_PATH"];
    delete process.env["REPOS_DB_PATH"];
    process.env["HASNA_REPOS_REQUIRE_EXPLICIT_DB_PATH"] = "1";

    try {
      const isolated = getDb(":memory:");
      isolated.query("INSERT INTO repos (path, name) VALUES ('/tmp/sdk-review', 'sdk-review')").run();

      expect(listRepos({ query: "sdk-review" })).toHaveLength(1);
      expect(getDb()).toBe(isolated);
      expect(() => getDb(join(tmpdir(), "different-repos.db"))).toThrow(
        "cannot switch Repos database paths while a database is open",
      );
    } finally {
      closeDb();
      if (previousPrimary === undefined) delete process.env["HASNA_REPOS_DB_PATH"];
      else process.env["HASNA_REPOS_DB_PATH"] = previousPrimary;
      if (previousFallback === undefined) delete process.env["REPOS_DB_PATH"];
      else process.env["REPOS_DB_PATH"] = previousFallback;
      if (previousRequirement === undefined) delete process.env["HASNA_REPOS_REQUIRE_EXPLICIT_DB_PATH"];
      else process.env["HASNA_REPOS_REQUIRE_EXPLICIT_DB_PATH"] = previousRequirement;
      getDb(":memory:");
    }
  });

  it("requires migrate:false opens to use an explicit non-default path and never discovers cwd or HOME", () => {
    closeDb();
    const dir = mkdtempSync(join(tmpdir(), "repos-unmigrated-open-"));
    const previousHome = process.env["HOME"];
    const previousPrimary = process.env["HASNA_REPOS_DB_PATH"];
    const previousFallback = process.env["REPOS_DB_PATH"];
    const previousRequirement = process.env["HASNA_REPOS_REQUIRE_EXPLICIT_DB_PATH"];
    const defaultPath = join(dir, ".hasna", "repos", "repos.db");
    mkdirSync(join(dir, ".repos"), { recursive: true });

    try {
      process.env["HOME"] = dir;
      delete process.env["HASNA_REPOS_DB_PATH"];
      delete process.env["REPOS_DB_PATH"];
      delete process.env["HASNA_REPOS_REQUIRE_EXPLICIT_DB_PATH"];

      expect(() => getDb(undefined, { migrate: false })).toThrow("explicit non-default Repos database path");
      expect(existsSync(defaultPath)).toBe(false);

      process.env["HASNA_REPOS_DB_PATH"] = defaultPath;
      expect(() => getDb(undefined, { migrate: false })).toThrow("explicit non-default Repos database path");
      expect(() => getDb(defaultPath, { migrate: false })).toThrow("explicit non-default Repos database path");
      expect(existsSync(defaultPath)).toBe(false);
    } finally {
      closeDb();
      if (previousHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = previousHome;
      if (previousPrimary === undefined) delete process.env["HASNA_REPOS_DB_PATH"];
      else process.env["HASNA_REPOS_DB_PATH"] = previousPrimary;
      if (previousFallback === undefined) delete process.env["REPOS_DB_PATH"];
      else process.env["REPOS_DB_PATH"] = previousFallback;
      if (previousRequirement === undefined) delete process.env["HASNA_REPOS_REQUIRE_EXPLICIT_DB_PATH"];
      else process.env["HASNA_REPOS_REQUIRE_EXPLICIT_DB_PATH"] = previousRequirement;
      rmSync(dir, { recursive: true, force: true });
      getDb(":memory:");
    }
  });

  it("migrates an explicitly opened unmigrated singleton exactly once on the first normal access", () => {
    closeDb();
    const dir = mkdtempSync(join(tmpdir(), "repos-deferred-migrate-"));
    const path = join(dir, "isolated.db");
    try {
      const raw = getDb(path, { migrate: false });
      expect(raw.query("SELECT name FROM sqlite_master WHERE name = 'migrations'").get()).toBeNull();

      const migrated = getDb(path);
      expect(migrated).toBe(raw);
      expect(migrated.query("SELECT version FROM migrations ORDER BY version").all())
        .toEqual([1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((version) => ({ version })));
      expect(getDb(path)).toBe(migrated);
      expect(migrated.query("SELECT count(*) AS count FROM migrations WHERE version = 9").get())
        .toEqual({ count: 1 });
      expect(() => getDb(join(dir, "other.db"))).toThrow("cannot switch Repos database paths");
    } finally {
      closeDb();
      rmSync(dir, { recursive: true, force: true });
      process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
      getDb(":memory:");
    }
  });

  it("should create repos table", () => {
    const db = getDb(":memory:");
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='repos'").get();
    expect(tables).toBeTruthy();
  });

  it("should create commits table", () => {
    const db = getDb(":memory:");
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='commits'").get();
    expect(tables).toBeTruthy();
  });

  it("should create branches table", () => {
    const db = getDb(":memory:");
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='branches'").get();
    expect(tables).toBeTruthy();
  });

  it("should create tags table", () => {
    const db = getDb(":memory:");
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='tags'").get();
    expect(tables).toBeTruthy();
  });

  it("should create remotes table", () => {
    const db = getDb(":memory:");
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='remotes'").get();
    expect(tables).toBeTruthy();
  });

  it("should create pull_requests table", () => {
    const db = getDb(":memory:");
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pull_requests'").get();
    expect(tables).toBeTruthy();
  });

  it("should create agents table", () => {
    const db = getDb(":memory:");
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='agents'").get();
    expect(tables).toBeTruthy();
  });

  it("should create automation_state table", () => {
    const db = getDb(":memory:");
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='automation_state'").get();
    expect(tables).toBeTruthy();
  });

  it("should create the durable repo relocation audit table", () => {
    const db = getDb(":memory:");
    const table = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='repo_relocation_audit'").get();
    expect(table).toBeTruthy();
  });

  it("should create the durable branch adjudication audit table", () => {
    const db = getDb(":memory:");
    const table = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='branch_adjudication_audit'").get();
    expect(table).toBeTruthy();
  });

  it("should create FTS5 tables", () => {
    const db = getDb(":memory:");
    const ftsRepos = db.query("SELECT name FROM sqlite_master WHERE name='fts_repos'").get();
    const ftsCommits = db.query("SELECT name FROM sqlite_master WHERE name='fts_commits'").get();
    const ftsPrs = db.query("SELECT name FROM sqlite_master WHERE name='fts_prs'").get();
    expect(ftsRepos).toBeTruthy();
    expect(ftsCommits).toBeTruthy();
    expect(ftsPrs).toBeTruthy();
  });

  it("should track migrations", () => {
    const db = getDb(":memory:");
    const migrations = db.query("SELECT version FROM migrations ORDER BY version").all() as { version: number }[];
    expect(migrations.length).toBeGreaterThanOrEqual(5);
    expect(migrations.map((row) => row.version)).toEqual([1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it("migrates existing branch uniqueness to include remote classification", () => {
    closeDb();
    const dir = mkdtempSync(join(tmpdir(), "repos-branch-identity-upgrade-"));
    const path = join(dir, "repos.db");
    const seed = new Database(path);
    seed.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE migrations (
        id INTEGER PRIMARY KEY,
        version INTEGER NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO migrations (version) VALUES (1), (2), (3), (4), (6), (7), (8), (9);
      CREATE TABLE repos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL
      );
      INSERT INTO repos (id, path, name) VALUES (1, '/tmp/existing', 'existing');
      CREATE TABLE branches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        is_remote INTEGER NOT NULL DEFAULT 0,
        last_commit_sha TEXT,
        last_commit_date TEXT,
        ahead INTEGER NOT NULL DEFAULT 0,
        behind INTEGER NOT NULL DEFAULT 0,
        UNIQUE(repo_id, name)
      );
      CREATE INDEX idx_branches_repo ON branches(repo_id);
      INSERT INTO branches (repo_id, name, is_remote, last_commit_sha)
        VALUES (1, 'origin/main', 0, 'local');
    `);
    seed.close();

    try {
      const migrated = getDb(path);
      migrated.query(`INSERT INTO branches (repo_id, name, is_remote, last_commit_sha)
        VALUES (1, 'origin/main', 1, 'remote')`).run();
      expect(migrated.query(`SELECT name, is_remote, last_commit_sha FROM branches
        WHERE repo_id = 1 ORDER BY is_remote`).all()).toEqual([
        { name: "origin/main", is_remote: 0, last_commit_sha: "local" },
        { name: "origin/main", is_remote: 1, last_commit_sha: "remote" },
      ]);
      expect(() => migrated.query(`INSERT INTO branches (repo_id, name, is_remote, last_commit_sha)
        VALUES (1, 'origin/main', 1, 'duplicate-remote')`).run()).toThrow("UNIQUE constraint failed");
      expect(migrated.query("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(migrated.query("SELECT version FROM migrations WHERE version = 10").get()).toEqual({ version: 10 });
    } finally {
      closeDb();
      rmSync(dir, { recursive: true, force: true });
      process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
      getDb(":memory:");
    }
  });

  it("refuses to proceed when a pre-existing worktree_leases is missing a column the writers need", () => {
    // The claim migration 14 makes is that it is safe against a station whose
    // table came from an out-of-tree build. `CREATE TABLE IF NOT EXISTS` alone
    // does not make that true — it silently accepts whatever is already there,
    // and the divergence then surfaces as an INSERT failing on one machine and
    // working on another. This asserts the loud failure.
    const dir = mkdtempSync(join(tmpdir(), "repos-lease-shape-"));
    const path = join(dir, "repos.db");
    const seed = new Database(path);
    seed.exec(`
      CREATE TABLE migrations (
        id INTEGER PRIMARY KEY,
        version INTEGER NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO migrations (version) VALUES (1), (2), (3), (4), (6), (7), (8), (9), (10), (11), (12), (13);
      CREATE TABLE worktree_leases (
        lease_id TEXT PRIMARY KEY,
        repo_path TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}'
      );
    `);
    seed.close();
    closeDb();
    try {
      // The diagnostic, not SQLite's "no such column: repo_id" — the first
      // version of this migration created the indexes in the same statement
      // block and died on the index before the check could run, which left the
      // migration marker unwritten and every later getDb() failing identically.
      expect(() => getDb(path)).toThrow(/worktree_leases exists with an unexpected schema/);
      closeDb();
      // Still refuses on retry, and still refuses with the diagnostic rather
      // than degrading into the raw SQLite error.
      expect(() => getDb(path)).toThrow(/missing columns: repo_id/);
    } finally {
      closeDb();
      rmSync(dir, { recursive: true, force: true });
      process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
      getDb(":memory:");
    }
  });

  it("applies v15 on a drifted registry whose unrelated tables carry pre-existing FK violations", () => {
    // Reproduces the 0.1.49 brick (todos 01c45b0c): the real registry maxes at
    // v14 and holds 1560 pre-existing orphan rows (branches 1230, tags 156,
    // commits 129, remotes 3, worktree_leases 42) referencing deleted repos
    // rows. v15's verifyAfterMarker ran PRAGMA foreign_key_check over the
    // WHOLE database, which can never pass there, so v15 never completed and
    // every repos verb exited 1 with no in-CLI recovery.
    closeDb();
    const dir = mkdtempSync(join(tmpdir(), "repos-drifted-v15-"));
    const path = join(dir, "repos.db");
    const monitorColumns = [
      "pr_key", "gh_owner", "gh_repo", "number", "first_seen_at", "last_seen_at",
      "last_observed_state", "last_head_sha", "last_updated_at",
      "last_seen_comment_id", "last_seen_comment_at", "last_classification",
      "last_classification_at", "last_emitted_fingerprint", "verdict_json",
      "ci_failing_json", "base_ref_oid", "current_main_sha",
    ];
    try {
      // 1. Bring a fresh registry through every migration as the clean
      //    baseline the fixture is rewound from.
      const seed = getDb(path);
      expect((seed.query("SELECT version FROM migrations ORDER BY version").all() as { version: number }[])
        .map((row) => row.version)).toEqual([1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
      closeDb();

      // 2. Rewind to the measured pre-v15 state (marker absent, v15 DDL
      //    dropped), then inject drift into unrelated tables exactly as the
      //    live registry carries it: orphan rows left behind when repos rows
      //    were deleted without cascade cleanup.
      const raw = new Database(path);
      raw.exec("PRAGMA foreign_keys = ON");
      raw.exec("DELETE FROM migrations WHERE version = 15");
      raw.exec("DROP TABLE pr_monitor_state");
      raw.exec("PRAGMA foreign_keys = OFF");
      raw.exec(`
        INSERT INTO repos (id, path, name) VALUES (999999, '/drifted/ghost', 'ghost');
        INSERT INTO branches (repo_id, name) VALUES
          (999999, 'origin/orphan-1'), (999999, 'origin/orphan-2'), (999999, 'origin/orphan-3');
        INSERT INTO tags (repo_id, name, sha) VALUES
          (999999, 'v0.0.0', 'abc'), (999999, 'v0.0.1', 'def');
        INSERT INTO commits (repo_id, sha, author_name, author_email, date, message)
          VALUES (999999, 'deadbeef', 'ghost', 'ghost@example.test', '2026-08-18', 'orphan commit');
        INSERT INTO remotes (repo_id, name, url) VALUES (999999, 'origin', 'git.example.test/ghost.git');
        INSERT INTO worktree_leases (
          lease_id, repo_id, repo_path, repo_catalog_id, machine_id, worktree_path,
          branch, base_ref, base_sha, task_id, run_id, mode, owner_metadata,
          cleanup_policy, status, created_at, updated_at, claimed_at
        ) VALUES (
          'drift-lease', '999999', '/drifted/ghost', 999999, 'station-test', '/tmp/ghost-wt',
          'main', 'origin/main', 'abc123', 'task-ghost', 'run-ghost', 'task', '{}',
          'delete', 'active', '2026-08-18 00:00:00', '2026-08-18 00:00:00', '2026-08-18 00:00:00'
        );
        DELETE FROM repos WHERE id = 999999;
      `);
      raw.exec("PRAGMA foreign_keys = ON");
      const violations = raw.query("PRAGMA foreign_key_check").all() as Array<{ table: string }>;
      expect(violations.length).toBe(8);
      const byTable: Record<string, number> = {};
      for (const row of violations) byTable[row.table] = (byTable[row.table] ?? 0) + 1;
      expect(byTable).toEqual({ branches: 3, tags: 2, commits: 1, remotes: 1, worktree_leases: 1 });
      raw.close();

      // 3. The drifted registry must migrate: the v15 marker lands, the
      //    monitor table is usable, and SDK verbs work. Pre-fix this throws
      //    "pr monitor migration failed foreign-key verification".
      const migrated = getDb(path);
      expect(migrated.query("SELECT version FROM migrations WHERE version = 15").get()).toEqual({ version: 15 });
      const columns = new Set(
        (migrated.query("PRAGMA table_info(pr_monitor_state)").all() as Array<{ name: string }>).map((c) => c.name),
      );
      for (const column of monitorColumns) expect(columns.has(column)).toBe(true);
      // The migration tolerates the drift; it does not repair it. The orphans
      // are a separately tracked repair lane, and they must remain observable.
      expect(migrated.query("PRAGMA foreign_key_check").all().length).toBe(8);
      migrated.query(`INSERT INTO pr_monitor_state (
        pr_key, gh_owner, gh_repo, number, last_seen_at, last_observed_state
      ) VALUES ('https://github.com/hasna/apps/pull/1', 'hasna', 'apps', 1, '2026-08-18 00:00:00', 'OPEN')`).run();
      expect(migrated.query("SELECT number FROM pr_monitor_state WHERE pr_key = ?")
        .get("https://github.com/hasna/apps/pull/1")).toEqual({ number: 1 });
      expect(listRepos({ query: "ghost" })).toEqual([]);

      // 4. Idempotent on the drifted registry: a second run is a no-op, and a
      //    re-run with the marker deleted again while the v15 DDL stays in
      //    place — the state the incident report describes — also succeeds.
      closeDb();
      const second = getDb(path);
      expect(second.query("SELECT version FROM migrations WHERE version = 15").get()).toEqual({ version: 15 });
      closeDb();
      const rawAgain = new Database(path);
      rawAgain.exec("DELETE FROM migrations WHERE version = 15");
      rawAgain.close();
      const third = getDb(path);
      expect(third.query("SELECT version FROM migrations WHERE version = 15").get()).toEqual({ version: 15 });
    } finally {
      closeDb();
      rmSync(dir, { recursive: true, force: true });
      process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
      getDb(":memory:");
    }
  });

  it("applies v15 on a clean registry and re-runs idempotently", () => {
    closeDb();
    const dir = mkdtempSync(join(tmpdir(), "repos-clean-v15-"));
    const path = join(dir, "repos.db");
    try {
      const first = getDb(path);
      expect((first.query("SELECT version FROM migrations ORDER BY version").all() as { version: number }[])
        .map((row) => row.version)).toEqual([1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
      expect(first.query("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(first.query("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_pr_monitor_state_owner'").get())
        .not.toBeNull();
      expect(first.query("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_pr_monitor_state_class'").get())
        .not.toBeNull();
      closeDb();
      const second = getDb(path);
      expect(second.query("SELECT version FROM migrations WHERE version = 15").get()).toEqual({ version: 15 });
    } finally {
      closeDb();
      rmSync(dir, { recursive: true, force: true });
      process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
      getDb(":memory:");
    }
  });

  it("upgrades the live migration-5 worktree schema without skipping relocation audit", () => {
    closeDb();
    const dir = mkdtempSync(join(tmpdir(), "repos-live-v5-upgrade-"));
    const path = join(dir, "repos.db");
    const seed = new Database(path);
    seed.exec(`
      CREATE TABLE migrations (
        id INTEGER PRIMARY KEY,
        version INTEGER NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO migrations (version) VALUES (5);
      CREATE TABLE worktree_leases (
        lease_id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        repo_path TEXT NOT NULL,
        repo_catalog_id INTEGER REFERENCES repos(id) ON DELETE SET NULL,
        machine_id TEXT NOT NULL,
        worktree_path TEXT NOT NULL UNIQUE,
        branch TEXT NOT NULL,
        base_ref TEXT NOT NULL,
        base_sha TEXT NOT NULL,
        task_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        owner_metadata TEXT NOT NULL DEFAULT '{}',
        cleanup_policy TEXT NOT NULL,
        status TEXT NOT NULL,
        git_common_dir TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        claimed_at TEXT NOT NULL,
        verified_at TEXT,
        released_at TEXT,
        last_error TEXT,
        UNIQUE(repo_id, machine_id, task_id, run_id, base_ref)
      );
    `);
    seed.close();
    try {
      const db = getDb(path);
      expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='worktree_leases'").get()).toBeTruthy();
      expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='repo_relocation_audit'").get()).toBeTruthy();
      expect((db.query("SELECT version FROM migrations ORDER BY version").all() as { version: number }[])
        .map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
      expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      closeDb();
      rmSync(dir, { recursive: true, force: true });
      process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
      getDb(":memory:");
    }
  });

  it("upgrades v6 receipts byte-for-byte and removes their current-state repo foreign key", () => {
    closeDb();
    const dir = mkdtempSync(join(tmpdir(), "repos-v6-receipt-upgrade-"));
    const path = join(dir, "repos.db");
    const seed = new Database(path);
    seed.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE migrations (
        id INTEGER PRIMARY KEY,
        version INTEGER NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO migrations (version) VALUES (1), (2), (3), (4), (6);
      CREATE TABLE repos (id INTEGER PRIMARY KEY);
      INSERT INTO repos (id) VALUES (2), (3);
      CREATE TABLE repo_relocation_audit (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        request_hash TEXT NOT NULL,
        plan_hash TEXT NOT NULL,
        repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE RESTRICT,
        target_repo_id INTEGER NOT NULL,
        operation TEXT NOT NULL CHECK (operation = 'primary_relocation'),
        actor TEXT NOT NULL,
        expected_current_path TEXT NOT NULL,
        target_path TEXT NOT NULL,
        expected_remote TEXT NOT NULL,
        expected_head TEXT NOT NULL,
        source_revision TEXT NOT NULL,
        target_revision TEXT NOT NULL,
        source_json TEXT NOT NULL,
        target_json TEXT NOT NULL,
        after_json TEXT NOT NULL,
        counts_json TEXT NOT NULL,
        collisions_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_repo_relocation_audit_repo
        ON repo_relocation_audit(repo_id, created_at);
      INSERT INTO repo_relocation_audit VALUES (
        'receipt-1', 'key-1', 'request-hash', 'plan-hash', 2, 3,
        'primary_relocation', 'test:actor', '/legacy', '/canonical',
        'github.com/hasna/accounts', '${"a".repeat(40)}', 'source-revision',
        'target-revision', '{"id":2}', '{"id":3}', '{"id":2}', '{}', '[]',
        '2026-07-15T00:00:00.000Z'
      );
      CREATE TABLE repo_relocation_audit_v7 (sentinel TEXT);
    `);
    const before = seed.query("SELECT * FROM repo_relocation_audit").get();
    seed.close();
    try {
      expect(() => getDb(path)).toThrow();
      closeDb();
      const recovery = new Database(path);
      expect(recovery.query("SELECT * FROM repo_relocation_audit").get()).toEqual(before);
      expect(recovery.query(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_repo_relocation_audit_repo'",
      ).get()).toEqual({ name: "idx_repo_relocation_audit_repo" });
      expect(recovery.query("SELECT version FROM migrations WHERE version = 7").get()).toBeNull();
      recovery.exec("DROP TABLE repo_relocation_audit_v7");
      // This fixture intentionally models only the v7 receipt shape. Mark the
      // later remote-bearing migrations as handled so this test remains scoped
      // to byte-preserving v7 recovery; v9 exact-schema behavior is covered
      // independently below.
      recovery.exec("INSERT INTO migrations (version) VALUES (8), (9)");
      recovery.close();

      const db = getDb(path);
      expect(db.query("SELECT * FROM repo_relocation_audit").get()).toEqual(before);
      expect(db.query("PRAGMA foreign_key_list(repo_relocation_audit)").all()).toEqual([]);
      db.query("DELETE FROM repos WHERE id = 2").run();
      expect(db.query("SELECT * FROM repo_relocation_audit").get()).toEqual(before);
      expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      closeDb();
      rmSync(dir, { recursive: true, force: true });
      process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
      getDb(":memory:");
    }
  });

  it("atomically sanitizes repository and remote identities, rebuilds FTS, and reopens idempotently", () => {
    closeDb();
    const dir = mkdtempSync(join(tmpdir(), "repos-v8-remote-sanitize-"));
    const path = join(dir, "repos.db");
    const credential = ["member", "phrase"].join(":");
    const queryMarker = ["access", "marker"].join("");
    const unsafe = `https://${credential}@Code.Example.test:8443/team/tool.git?key=${queryMarker}#fragment`;
    try {
      const initial = getDb(path);
      initial.query("DELETE FROM migrations WHERE version = 8").run();
      const repo = initial.query("INSERT INTO repos (path, name, remote_url) VALUES (?, ?, ?) RETURNING id")
        .get(join(dir, "repo"), "repo", unsafe) as { id: number };
      initial.query("INSERT INTO remotes (repo_id, name, url, fetch_url) VALUES (?, 'origin', ?, ?)")
        .run(repo.id, unsafe, "file:///local/fetch");
      initial.query("INSERT INTO remotes (repo_id, name, url) VALUES (?, 'local', 'file:///local/repo')").run(repo.id);
      closeDb();

      const migrated = getDb(path);
      expect(migrated.query("SELECT remote_url FROM repos WHERE id = ?").get(repo.id)).toEqual({
        remote_url: "code.example.test/team/tool",
      });
      expect(migrated.query("SELECT name, url, fetch_url FROM remotes WHERE repo_id = ? ORDER BY name").all(repo.id)).toEqual([{
        name: "origin",
        url: "code.example.test/team/tool",
        fetch_url: null,
      }]);
      expect(migrated.query("SELECT rowid FROM fts_repos WHERE fts_repos MATCH ?").all(queryMarker)).toEqual([]);
      expect(migrated.query("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(migrated.query("SELECT count(*) AS count FROM migrations WHERE version = 8").get()).toEqual({ count: 1 });
      closeDb();

      const reopened = getDb(path);
      expect(reopened.query("SELECT remote_url FROM repos WHERE id = ?").get(repo.id)).toEqual({
        remote_url: "code.example.test/team/tool",
      });
      expect(reopened.query("SELECT count(*) AS count FROM migrations WHERE version = 8").get()).toEqual({ count: 1 });
    } finally {
      closeDb();
      rmSync(dir, { recursive: true, force: true });
      process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
      getDb(":memory:");
    }
  });

  it("rolls back every v8 rewrite and its marker when a synthetic migration step fails", () => {
    closeDb();
    const dir = mkdtempSync(join(tmpdir(), "repos-v8-remote-rollback-"));
    const path = join(dir, "repos.db");
    const unsafe = `ssh://${["actor", "phrase"].join(":")}@git.example.test/team/tool.git`;
    let repoId = 0;
    try {
      const initial = getDb(path);
      initial.query("DELETE FROM migrations WHERE version = 8").run();
      repoId = Number((initial.query("INSERT INTO repos (path, name, remote_url) VALUES (?, ?, ?) RETURNING id")
        .get(join(dir, "repo"), "repo", unsafe) as { id: number }).id);
      initial.exec(`
        CREATE TRIGGER synthetic_v8_failure BEFORE UPDATE OF remote_url ON repos
        WHEN NEW.id = ${repoId}
        BEGIN SELECT RAISE(ABORT, 'synthetic migration failure'); END;
      `);
      closeDb();

      expect(() => getDb(path)).toThrow("synthetic migration failure");
      closeDb();
      const afterFailure = new Database(path);
      expect(afterFailure.query("SELECT remote_url FROM repos WHERE id = ?").get(repoId)).toEqual({ remote_url: unsafe });
      expect(afterFailure.query("SELECT version FROM migrations WHERE version = 8").get()).toBeNull();
      afterFailure.exec("DROP TRIGGER synthetic_v8_failure");
      afterFailure.close();

      const recovered = getDb(path);
      expect(recovered.query("SELECT remote_url FROM repos WHERE id = ?").get(repoId)).toEqual({
        remote_url: "git.example.test/team/tool",
      });
      expect(recovered.query("SELECT count(*) AS count FROM migrations WHERE version = 8").get()).toEqual({ count: 1 });
    } finally {
      closeDb();
      rmSync(dir, { recursive: true, force: true });
      process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
      getDb(":memory:");
    }
  });

  it("applies v9 after an exact v8 marker and sanitizes later remote-bearing state", () => {
    closeDb();
    const dir = mkdtempSync(join(tmpdir(), "repos-v9-after-v8-"));
    const path = join(dir, "repos.db");
    const unsafe = `https://${["actor", "phrase"].join(":")}@git.example.test/team/tool.git?query=marker`;
    const seed = new Database(path);
    seed.exec(`
      CREATE TABLE migrations (
        id INTEGER PRIMARY KEY,
        version INTEGER NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO migrations (version) VALUES (1), (2), (3), (4), (6), (7), (8);
      CREATE TABLE repos (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        remote_url TEXT
      );
      CREATE TABLE remotes (
        id INTEGER PRIMARY KEY,
        repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        fetch_url TEXT
      );
      CREATE TABLE repo_relocation_audit (
        id TEXT PRIMARY KEY,
        expected_remote TEXT NOT NULL,
        source_json TEXT NOT NULL,
        target_json TEXT NOT NULL,
        after_json TEXT NOT NULL
      );
    `);
    seed.query("INSERT INTO repos (id, path, name, remote_url) VALUES (1, '/tmp/v9', 'v9', ?)").run(unsafe);
    seed.query("INSERT INTO remotes (id, repo_id, name, url, fetch_url) VALUES (1, 1, 'origin', ?, ?)")
      .run(unsafe, unsafe);
    seed.query("INSERT INTO remotes (id, repo_id, name, url) VALUES (2, 1, 'local', 'file:///tmp/v9')").run();
    const snapshot = JSON.stringify({ id: 1, path: "/tmp/v9", name: "v9", remote_url: unsafe });
    seed.query(`INSERT INTO repo_relocation_audit
      (id, expected_remote, source_json, target_json, after_json) VALUES ('receipt-v9', ?, ?, ?, ?)`)
      .run(unsafe, snapshot, snapshot, snapshot);
    seed.close();

    try {
      const migrated = getDb(path);
      expect(migrated.query("SELECT remote_url FROM repos WHERE id = 1").get()).toEqual({
        remote_url: "git.example.test/team/tool",
      });
      expect(migrated.query("SELECT name, url, fetch_url FROM remotes ORDER BY id").all()).toEqual([{
        name: "origin",
        url: "git.example.test/team/tool",
        fetch_url: "git.example.test/team/tool",
      }]);
      const receipt = migrated.query(`SELECT expected_remote, source_json, target_json, after_json
        FROM repo_relocation_audit WHERE id = 'receipt-v9'`).get() as Record<string, string>;
      expect(receipt.expected_remote).toBe("git.example.test/team/tool");
      for (const field of ["source_json", "target_json", "after_json"]) {
        expect(JSON.parse(receipt[field]!)).toMatchObject({ remote_url: "git.example.test/team/tool" });
      }
      expect(JSON.stringify(receipt)).not.toContain("phrase");
      expect(migrated.query("SELECT count(*) AS count FROM migrations WHERE version = 9").get()).toEqual({ count: 1 });
    } finally {
      closeDb();
      rmSync(dir, { recursive: true, force: true });
      process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
      getDb(":memory:");
    }
  });

  it("rolls back v9 without a marker when any required remote-bearing column is missing", () => {
    closeDb();
    const dir = mkdtempSync(join(tmpdir(), "repos-v9-schema-guard-"));
    const unsafe = `https://${["actor", "phrase"].join(":")}@git.example.test/team/tool.git`;
    const cases = [
      { name: "repos.remote_url", repos: "id INTEGER PRIMARY KEY, path TEXT, name TEXT", remotes: "id INTEGER PRIMARY KEY, url TEXT, fetch_url TEXT", audit: "id TEXT PRIMARY KEY, expected_remote TEXT, source_json TEXT, target_json TEXT, after_json TEXT" },
      { name: "remotes.fetch_url", repos: "id INTEGER PRIMARY KEY, path TEXT, name TEXT, remote_url TEXT", remotes: "id INTEGER PRIMARY KEY, url TEXT", audit: "id TEXT PRIMARY KEY, expected_remote TEXT, source_json TEXT, target_json TEXT, after_json TEXT" },
      { name: "repo_relocation_audit.target_json", repos: "id INTEGER PRIMARY KEY, path TEXT, name TEXT, remote_url TEXT", remotes: "id INTEGER PRIMARY KEY, url TEXT, fetch_url TEXT", audit: "id TEXT PRIMARY KEY, expected_remote TEXT, source_json TEXT, after_json TEXT" },
    ];

    try {
      for (const item of cases) {
        const path = join(dir, `${item.name.replace(/[^a-z]+/gi, "-")}.db`);
        const seed = new Database(path);
        seed.exec(`
          CREATE TABLE migrations (id INTEGER PRIMARY KEY, version INTEGER NOT NULL UNIQUE);
          INSERT INTO migrations (version) VALUES (1), (2), (3), (4), (6), (7), (8);
          CREATE TABLE repos (${item.repos});
          CREATE TABLE remotes (${item.remotes});
          CREATE TABLE repo_relocation_audit (${item.audit});
        `);
        if (item.repos.includes("remote_url")) {
          seed.query("INSERT INTO repos (id, path, name, remote_url) VALUES (1, '/tmp/guard', 'guard', ?)").run(unsafe);
        }
        seed.close();

        expect(() => getDb(path)).toThrow("v9 requires the exact remote-bearing schema");
        closeDb();
        const raw = new Database(path);
        expect(raw.query("SELECT version FROM migrations WHERE version = 9").get()).toBeNull();
        if (item.repos.includes("remote_url")) {
          expect(raw.query("SELECT remote_url FROM repos WHERE id = 1").get()).toEqual({ remote_url: unsafe });
        }
        raw.close();
      }
    } finally {
      closeDb();
      rmSync(dir, { recursive: true, force: true });
      process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
      getDb(":memory:");
    }
  });

  it("rolls back v9 when a trigger recontaminates a sanitized value before the marker", () => {
    closeDb();
    const dir = mkdtempSync(join(tmpdir(), "repos-v9-trigger-guard-"));
    const path = join(dir, "repos.db");
    const unsafe = `https://${["actor", "phrase"].join(":")}@git.example.test/team/tool.git`;
    const seed = new Database(path);
    seed.exec(`
      CREATE TABLE migrations (id INTEGER PRIMARY KEY, version INTEGER NOT NULL UNIQUE);
      INSERT INTO migrations (version) VALUES (1), (2), (3), (4), (6), (7), (8);
      CREATE TABLE repos (id INTEGER PRIMARY KEY, path TEXT, name TEXT, remote_url TEXT);
      CREATE TABLE remotes (id INTEGER PRIMARY KEY, url TEXT, fetch_url TEXT);
      CREATE TABLE repo_relocation_audit (
        id TEXT PRIMARY KEY, expected_remote TEXT, source_json TEXT, target_json TEXT, after_json TEXT
      );
      INSERT INTO repos (id, path, name, remote_url)
        VALUES (1, '/tmp/trigger-guard', 'trigger-guard', '${unsafe}');
      CREATE TRIGGER repos_remote_recontaminate AFTER UPDATE OF remote_url ON repos
      BEGIN
        UPDATE repos SET remote_url = '${unsafe}' WHERE id = NEW.id;
      END;
    `);
    seed.close();

    try {
      expect(() => getDb(path)).toThrow("remote identity successor migration failed exact-state verification");
      closeDb();
      const raw = new Database(path);
      expect(raw.query("SELECT remote_url FROM repos WHERE id = 1").get()).toEqual({ remote_url: unsafe });
      expect(raw.query("SELECT version FROM migrations WHERE version = 9").get()).toBeNull();
      raw.close();
    } finally {
      closeDb();
      rmSync(dir, { recursive: true, force: true });
      process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
      getDb(":memory:");
    }
  });

  it("rolls back v9 when the real migration marker insert triggers recontamination", () => {
    closeDb();
    const dir = mkdtempSync(join(tmpdir(), "repos-v9-marker-trigger-"));
    const path = join(dir, "repos.db");
    const unsafe = `https://${["actor", "phrase"].join(":")}@git.example.test/team/tool.git`;
    const seed = new Database(path);
    seed.exec(`
      CREATE TABLE migrations (id INTEGER PRIMARY KEY, version INTEGER NOT NULL UNIQUE);
      INSERT INTO migrations (version) VALUES (1), (2), (3), (4), (6), (7), (8);
      CREATE TABLE repos (id INTEGER PRIMARY KEY, path TEXT, name TEXT, remote_url TEXT);
      CREATE TABLE remotes (id INTEGER PRIMARY KEY, url TEXT, fetch_url TEXT);
      CREATE TABLE repo_relocation_audit (
        id TEXT PRIMARY KEY, expected_remote TEXT, source_json TEXT, target_json TEXT, after_json TEXT
      );
      INSERT INTO repos (id, path, name, remote_url)
        VALUES (1, '/tmp/marker-trigger', 'marker-trigger', '${unsafe}');
      CREATE TRIGGER migrations_v9_recontaminate AFTER INSERT ON migrations
      WHEN NEW.version = 9
      BEGIN
        UPDATE repos SET remote_url = '${unsafe}' WHERE id = 1;
      END;
    `);
    seed.close();

    try {
      expect(() => getDb(path)).toThrow("remote identity successor migration failed exact-state verification");
      closeDb();
      const raw = new Database(path);
      expect(raw.query("SELECT remote_url FROM repos WHERE id = 1").get()).toEqual({ remote_url: unsafe });
      expect(raw.query("SELECT version FROM migrations WHERE version = 9").get()).toBeNull();
      raw.close();
    } finally {
      closeDb();
      rmSync(dir, { recursive: true, force: true });
      process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
      getDb(":memory:");
    }
  });

  it("rolls back v9 when the marker trigger makes canonical same-count substitutions", () => {
    closeDb();
    const dir = mkdtempSync(join(tmpdir(), "repos-v9-exact-marker-"));
    const path = join(dir, "repos.db");
    const original = "github.com/hasna/original";
    const substituted = "github.com/hasna/substituted";
    const seed = new Database(path);
    seed.exec(`
      CREATE TABLE migrations (id INTEGER PRIMARY KEY, version INTEGER NOT NULL UNIQUE);
      INSERT INTO migrations (version) VALUES (1), (2), (3), (4), (6), (7), (8);
      CREATE TABLE repos (id INTEGER PRIMARY KEY, path TEXT, name TEXT, remote_url TEXT);
      CREATE TABLE remotes (id INTEGER PRIMARY KEY, url TEXT, fetch_url TEXT);
      CREATE TABLE repo_relocation_audit (
        id TEXT PRIMARY KEY, expected_remote TEXT, source_json TEXT, target_json TEXT, after_json TEXT
      );
      INSERT INTO repos VALUES (1, '/tmp/exact-marker', 'exact-marker', '${original}');
      INSERT INTO remotes VALUES (11, '${original}', '${original}');
      INSERT INTO repo_relocation_audit VALUES (
        'exact-receipt', '${original}',
        '{"remote_url":"${original}"}',
        '{"remote_url":"${original}"}',
        '{"remote_url":"${original}"}'
      );
      CREATE TRIGGER migrations_v9_substitute AFTER INSERT ON migrations
      WHEN NEW.version = 9
      BEGIN
        UPDATE repos SET remote_url = '${substituted}' WHERE id = 1;
        DELETE FROM remotes WHERE id = 11;
        INSERT INTO remotes VALUES (12, '${substituted}', '${substituted}');
        UPDATE repo_relocation_audit SET
          expected_remote = '${substituted}',
          source_json = '{"remote_url":"${substituted}"}'
          WHERE id = 'exact-receipt';
      END;
    `);
    seed.close();

    try {
      expect(() => getDb(path)).toThrow("remote identity successor migration failed exact-state verification");
      closeDb();
      const raw = new Database(path);
      expect(raw.query("SELECT id, remote_url FROM repos").all()).toEqual([{ id: 1, remote_url: original }]);
      expect(raw.query("SELECT id, url, fetch_url FROM remotes").all()).toEqual([{
        id: 11,
        url: original,
        fetch_url: original,
      }]);
      expect(raw.query("SELECT expected_remote, source_json FROM repo_relocation_audit").get()).toEqual({
        expected_remote: original,
        source_json: JSON.stringify({ remote_url: original }),
      });
      expect(raw.query("SELECT version FROM migrations WHERE version = 9").get()).toBeNull();
      raw.close();
    } finally {
      closeDb();
      rmSync(dir, { recursive: true, force: true });
      process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
      getDb(":memory:");
    }
  });

  it("rolls back v9 when the marker trigger changes a non-remote receipt field", () => {
    closeDb();
    const dir = mkdtempSync(join(tmpdir(), "repos-v9-complete-receipt-"));
    const path = join(dir, "repos.db");
    const identity = "github.com/hasna/original";
    const seed = new Database(path);
    seed.exec(`
      CREATE TABLE migrations (id INTEGER PRIMARY KEY, version INTEGER NOT NULL UNIQUE);
      INSERT INTO migrations (version) VALUES (1), (2), (3), (4), (6), (7), (8);
      CREATE TABLE repos (id INTEGER PRIMARY KEY, path TEXT, name TEXT, remote_url TEXT);
      CREATE TABLE remotes (id INTEGER PRIMARY KEY, url TEXT, fetch_url TEXT);
      CREATE TABLE repo_relocation_audit (
        id TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        expected_remote TEXT NOT NULL,
        source_json TEXT NOT NULL,
        target_json TEXT NOT NULL,
        after_json TEXT NOT NULL
      );
      INSERT INTO repos VALUES (1, '/tmp/complete-receipt', 'complete-receipt', '${identity}');
      INSERT INTO repo_relocation_audit VALUES (
        'complete-receipt', 'reviewed-actor', '${identity}',
        '{"remote_url":"${identity}"}',
        '{"remote_url":"${identity}"}',
        '{"remote_url":"${identity}"}'
      );
      CREATE TRIGGER migrations_v9_change_actor AFTER INSERT ON migrations
      WHEN NEW.version = 9
      BEGIN
        UPDATE repo_relocation_audit SET actor = 'substituted-actor'
        WHERE id = 'complete-receipt';
      END;
    `);
    seed.close();

    try {
      expect(() => getDb(path)).toThrow("remote identity successor migration failed exact-state verification");
      closeDb();
      const raw = new Database(path);
      expect(raw.query("SELECT actor FROM repo_relocation_audit").get()).toEqual({ actor: "reviewed-actor" });
      expect(raw.query("SELECT version FROM migrations WHERE version = 9").get()).toBeNull();
      raw.close();
    } finally {
      closeDb();
      rmSync(dir, { recursive: true, force: true });
      process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
      getDb(":memory:");
    }
  });

  it("serializes concurrent first-open migrations across processes", async () => {
    closeDb();
    const dir = mkdtempSync(join(tmpdir(), "repos-concurrent-first-open-"));
    const path = join(dir, "repos.db");
    const databaseModule = join(import.meta.dir, "database.ts");
    const script = `
      import { readFileSync } from "node:fs";
      readFileSync(0);
      const { getDb, closeDb } = await import(${JSON.stringify(databaseModule)});
      try {
        const db = getDb();
        const versions = db.query("SELECT version FROM migrations ORDER BY version").all();
        process.stdout.write(JSON.stringify(versions));
        closeDb();
      } catch (error) {
        process.stderr.write(error instanceof Error
          ? (error.stack || error.message) + "\\ncode=" + String(error.code)
          : String(error));
        process.exitCode = 1;
      }
    `;
    try {
      const children = Array.from({ length: 8 }, () => {
        const child = spawn(process.execPath, ["-e", script], {
          env: { ...process.env, HASNA_REPOS_DB_PATH: path },
          stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
        child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
        const completed = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
          child.on("close", (code) => resolve({ code, stdout, stderr }));
        });
        return { child, completed };
      });

      // All workers block on stdin until every process has been spawned.
      for (const { child } of children) child.stdin.end("start\n");
      const results = await Promise.all(children.map(({ completed }) => completed));
      expect(results).toEqual(Array.from({ length: 8 }, () => ({
        code: 0,
        stdout: JSON.stringify([1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((version) => ({ version }))),
        stderr: "",
      })));
    } finally {
      closeDb();
      rmSync(dir, { recursive: true, force: true });
      process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
      getDb(":memory:");
    }
  });

  it("migrates a fresh database to v15 with pr_monitor_state and pull_requests.base_ref_oid", () => {
    const db = getDb(":memory:");
    const versions = (db.query("SELECT version FROM migrations ORDER BY version").all() as { version: number }[])
      .map((row) => row.version);
    expect(versions).toEqual([1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

    expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pr_monitor_state'").get()).toBeTruthy();

    const columns = new Set(
      (db.query("PRAGMA table_info(pr_monitor_state)").all() as Array<{ name: string }>).map((column) => column.name),
    );
    for (const column of [
      "pr_key", "gh_owner", "gh_repo", "number", "first_seen_at", "last_seen_at",
      "last_observed_state", "last_head_sha", "last_updated_at", "last_seen_comment_id",
      "last_seen_comment_at", "last_classification", "last_classification_at",
      "last_emitted_fingerprint", "verdict_json", "ci_failing_json", "base_ref_oid",
      "current_main_sha",
    ]) {
      expect(columns.has(column)).toBe(true);
    }

    const prColumns = new Set(
      (db.query("PRAGMA table_info(pull_requests)").all() as Array<{ name: string }>).map((column) => column.name),
    );
    expect(prColumns.has("base_ref_oid")).toBe(true);

    for (const index of ["idx_prs_base_ref_oid", "idx_pr_monitor_state_owner", "idx_pr_monitor_state_class"]) {
      expect(db.query("SELECT name FROM sqlite_master WHERE type='index' AND name = ?").get(index)).toEqual({ name: index });
    }

    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("enforces pr_monitor_state identity uniqueness and the comment cursor default", () => {
    const db = getDb(":memory:");
    const insert = db.query(`INSERT INTO pr_monitor_state
      (pr_key, gh_owner, gh_repo, number, last_seen_at, last_observed_state)
      VALUES (?, ?, ?, ?, datetime('now'), 'open')`);
    insert.run("https://github.com/hasna/apps/pull/1", "hasna", "apps", 1);
    // Same pr_key is the primary key.
    expect(() => insert.run("https://github.com/hasna/apps/pull/1", "hasna", "apps", 1))
      .toThrow("UNIQUE constraint failed");
    // Same (gh_owner, gh_repo, number) with a different pr_key is the identity UNIQUE.
    expect(() => insert.run("https://github.com/hasna/other/pull/1", "hasna", "apps", 1))
      .toThrow("UNIQUE constraint failed");
    const row = db.query("SELECT last_seen_comment_id, first_seen_at FROM pr_monitor_state WHERE pr_key = ?")
      .get("https://github.com/hasna/apps/pull/1") as { last_seen_comment_id: number; first_seen_at: string };
    expect(row.last_seen_comment_id).toBe(0);
    expect(row.first_seen_at).toBeTruthy();
  });

  it("upgrades an existing v14 database to v15 in place, preserving pull_request rows", () => {
    closeDb();
    const dir = mkdtempSync(join(tmpdir(), "repos-v15-upgrade-"));
    const path = join(dir, "repos.db");
    const seed = new Database(path);
    seed.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE migrations (
        id INTEGER PRIMARY KEY,
        version INTEGER NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO migrations (version) VALUES (1), (2), (3), (4), (6), (7), (8), (9), (10), (11), (12), (13), (14);
      CREATE TABLE repos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL
      );
      INSERT INTO repos (id, path, name) VALUES (1, '/tmp/v15', 'v15');
      CREATE TABLE pull_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
        number INTEGER NOT NULL,
        title TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'open',
        author TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        merged_at TEXT,
        closed_at TEXT,
        url TEXT,
        base_branch TEXT,
        head_branch TEXT,
        additions INTEGER NOT NULL DEFAULT 0,
        deletions INTEGER NOT NULL DEFAULT 0,
        changed_files INTEGER NOT NULL DEFAULT 0,
        head_sha TEXT,
        mergeable TEXT,
        merge_state_status TEXT,
        ci_state TEXT,
        is_draft INTEGER NOT NULL DEFAULT 0,
        review_decision TEXT,
        gh_owner TEXT,
        gh_repo TEXT,
        UNIQUE(repo_id, number)
      );
      INSERT INTO pull_requests (
        id, repo_id, number, title, state, author, created_at, url,
        base_branch, head_branch, head_sha, gh_owner, gh_repo
      ) VALUES (
        1, 1, 42, 'existing pr', 'open', 'tester', '2026-08-01T00:00:00.000Z',
        'https://github.com/hasna/apps/pull/42', 'main', 'feature/x', '${"a".repeat(40)}', 'hasna', 'apps'
      );
    `);
    seed.close();
    try {
      const db = getDb(path);
      expect(db.query("SELECT version FROM migrations WHERE version = 15").get()).toEqual({ version: 15 });
      expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pr_monitor_state'").get()).toBeTruthy();
      expect(db.query("SELECT number, title, base_ref_oid FROM pull_requests WHERE id = 1").get()).toEqual({
        number: 42,
        title: "existing pr",
        base_ref_oid: null,
      });
      expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
      closeDb();

      const reopened = getDb(path);
      expect(reopened.query("SELECT count(*) AS count FROM migrations WHERE version = 15").get()).toEqual({ count: 1 });
      expect(reopened.query("SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_prs_base_ref_oid'").get())
        .toEqual({ name: "idx_prs_base_ref_oid" });
    } finally {
      closeDb();
      rmSync(dir, { recursive: true, force: true });
      process.env["HASNA_REPOS_DB_PATH"] = ":memory:";
      getDb(":memory:");
    }
  });

  it("should have foreign keys enabled", () => {
    const db = getDb(":memory:");
    const result = db.query("PRAGMA foreign_keys").get() as any;
    expect(result.foreign_keys).toBe(1);
  });
});
