import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  LegacyStoreMigrationError,
  migrateLegacyInstructionsStore,
} from "./legacy-store-migration.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "instructions-legacy-migration-"));
  roots.push(root);
  const sourcePath = join(root, "configs.db");
  const destinationPath = join(root, "instructions.db");
  const backupPath = join(root, "instructions.before-migration.db");
  return { root, sourcePath, destinationPath, backupPath };
}

function createLegacy(path: string): void {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE configs (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL, agent TEXT NOT NULL, target_path TEXT,
      format TEXT NOT NULL, content TEXT NOT NULL, description TEXT,
      tags TEXT NOT NULL, is_template INTEGER NOT NULL, version INTEGER NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, synced_at TEXT
    );
    CREATE TABLE config_snapshots (
      id TEXT PRIMARY KEY, config_id TEXT NOT NULL, content TEXT NOT NULL,
      version INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE profiles (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE profile_configs (
      profile_id TEXT NOT NULL, config_id TEXT NOT NULL, sort_order INTEGER NOT NULL,
      PRIMARY KEY (profile_id, config_id)
    );
    CREATE TABLE machines (
      id TEXT PRIMARY KEY, hostname TEXT NOT NULL UNIQUE, os TEXT,
      last_applied_at TEXT, created_at TEXT NOT NULL
    );
  `);
  db.run(
    `INSERT INTO configs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ["cfg-1", "Legacy rules", "legacy-rules", "rules", "codex", "~/.codex/AGENTS.md", "markdown", "preserve this content", "legacy description", '["legacy","safe"]', 0, 3, "2025-01-01T00:00:00.000Z", "2025-02-01T00:00:00.000Z", null],
  );
  db.run(
    `INSERT INTO config_snapshots VALUES (?, ?, ?, ?, ?)`,
    ["snap-1", "cfg-1", "old content", 1, "2025-01-01T00:00:00.000Z"],
  );
  db.run(
    `INSERT INTO profiles VALUES (?, ?, ?, ?, ?, ?)`,
    ["profile-1", "Legacy profile", "legacy-profile", "profile metadata", "2025-01-01T00:00:00.000Z", "2025-02-01T00:00:00.000Z"],
  );
  db.run(`INSERT INTO profile_configs VALUES (?, ?, ?)`, ["profile-1", "cfg-1", 4]);
  db.run(
    `INSERT INTO machines VALUES (?, ?, ?, ?, ?)`,
    ["machine-1", "legacy-host", "darwin", "2025-02-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z"],
  );
  db.close();
}

function createCurrent(path: string): void {
  const db = new Database(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE configs (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL DEFAULT 'file', category TEXT NOT NULL,
      agent TEXT NOT NULL DEFAULT 'global', target_path TEXT,
      outputs TEXT NOT NULL DEFAULT '[]', format TEXT NOT NULL DEFAULT 'text',
      content TEXT NOT NULL DEFAULT '', description TEXT, tags TEXT NOT NULL DEFAULT '[]',
      is_template INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, synced_at TEXT
    );
    CREATE TABLE config_snapshots (
      id TEXT PRIMARY KEY, config_id TEXT NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
      content TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE profiles (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      description TEXT, selectors TEXT NOT NULL DEFAULT '{}', variables TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE profile_configs (
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      config_id TEXT NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      binding TEXT NOT NULL DEFAULT '{"schema":"hasna.instructions.profile-config-binding/v1","activation":{"mode":"always"},"required":true,"fallback":"fail"}',
      PRIMARY KEY (profile_id, config_id)
    );
    CREATE TABLE machines (
      id TEXT PRIMARY KEY, hostname TEXT NOT NULL UNIQUE, os TEXT, arch TEXT,
      last_applied_at TEXT, created_at TEXT NOT NULL
    );
  `);
  db.close();
}

const operatorOptions = { operatorConfirmed: true as const };

describe("legacy Instructions SQLite migration", () => {
  test("dry-run returns deterministic counts without changing either database", () => {
    const paths = fixture();
    createLegacy(paths.sourcePath);
    createCurrent(paths.destinationPath);
    const sourceBefore = readFileSync(paths.sourcePath);
    const destinationBefore = readFileSync(paths.destinationPath);

    const first = migrateLegacyInstructionsStore({
      ...paths,
      ...operatorOptions,
      dryRun: true,
    });
    const second = migrateLegacyInstructionsStore({
      ...paths,
      ...operatorOptions,
      dryRun: true,
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      dryRun: true,
      source: { configs: 1, snapshots: 1, profiles: 1, profileConfigs: 1, machines: 1 },
      migrated: { configs: 1, snapshots: 2, profiles: 1, profileConfigs: 1, machines: 1 },
      skipped: { configs: 0, snapshots: 0, profiles: 0, profileConfigs: 0, machines: 0 },
      conflicts: 0,
      snapshotsCreated: 1,
      backupCreated: false,
    });
    expect(readFileSync(paths.sourcePath)).toEqual(sourceBefore);
    expect(readFileSync(paths.destinationPath)).toEqual(destinationBefore);
    expect(Bun.file(paths.backupPath).size).toBe(0);
  });

  test("applies atomically, preserves compatible metadata, creates the missing current-version snapshot, and backs up destination", () => {
    const paths = fixture();
    createLegacy(paths.sourcePath);
    createCurrent(paths.destinationPath);
    const destinationBefore = readFileSync(paths.destinationPath);
    const sourceBefore = readFileSync(paths.sourcePath);

    const result = migrateLegacyInstructionsStore({
      ...paths,
      ...operatorOptions,
      dryRun: false,
    });

    expect(result.backupCreated).toBe(true);
    expect(readFileSync(paths.backupPath)).toEqual(destinationBefore);
    expect(statSync(paths.backupPath).mode & 0o777).toBe(0o600);
    const db = new Database(paths.destinationPath, { readonly: true });
    const config = db.query<Record<string, unknown>, []>("SELECT * FROM configs").get()!;
    expect(config).toMatchObject({
      id: "cfg-1", name: "Legacy rules", slug: "legacy-rules", kind: "file",
      content: "preserve this content", description: "legacy description",
      tags: '["legacy","safe"]', outputs: "[]", version: 3,
      created_at: "2025-01-01T00:00:00.000Z", updated_at: "2025-02-01T00:00:00.000Z",
    });
    const snapshots = db.query<{ id: string; version: number; content: string }, []>(
      "SELECT id, version, content FROM config_snapshots ORDER BY version, id",
    ).all();
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toEqual({ id: "snap-1", version: 1, content: "old content" });
    expect(snapshots[1]!.version).toBe(3);
    expect(snapshots[1]!.content).toBe("preserve this content");
    expect(snapshots[1]!.id).toMatch(/^legacy-current-/);
    expect(db.query("SELECT * FROM profiles").get()).toMatchObject({ id: "profile-1", selectors: "{}", variables: "{}" });
    expect(db.query("SELECT * FROM profile_configs").get()).toMatchObject({ profile_id: "profile-1", config_id: "cfg-1", sort_order: 4 });
    expect(db.query("SELECT * FROM machines").get()).toMatchObject({ id: "machine-1", hostname: "legacy-host", arch: null });
    db.close();
    expect(readFileSync(paths.sourcePath)).toEqual(sourceBefore);
  });

  test("refuses a non-empty destination unless an explicit merge policy is supplied", () => {
    const paths = fixture();
    createLegacy(paths.sourcePath);
    createCurrent(paths.destinationPath);
    const db = new Database(paths.destinationPath);
    db.run(
      `INSERT INTO configs (id, name, slug, category, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["existing", "Existing", "existing", "rules", "keep", "2026-01-01", "2026-01-01"],
    );
    db.close();

    expect(() => migrateLegacyInstructionsStore({ ...paths, ...operatorOptions, dryRun: true }))
      .toThrow(LegacyStoreMigrationError);
    expect(Bun.file(paths.backupPath).size).toBe(0);
  });

  test("preserve-destination merge never overwrites and reports stable skips/conflicts", () => {
    const paths = fixture();
    createLegacy(paths.sourcePath);
    createCurrent(paths.destinationPath);
    const db = new Database(paths.destinationPath);
    db.run(
      `INSERT INTO configs (id, name, slug, category, content, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["cfg-1", "Destination copy", "destination-copy", "rules", "do not overwrite", 9, "2026-01-01", "2026-01-01"],
    );
    db.close();

    const result = migrateLegacyInstructionsStore({
      ...paths,
      ...operatorOptions,
      dryRun: false,
      mergePolicy: "preserve-destination",
    });

    expect(result.conflicts).toBe(1);
    expect(result.migrated.configs).toBe(0);
    expect(result.skipped.configs).toBe(1);
    expect(result.migrated.snapshots).toBe(0);
    const verify = new Database(paths.destinationPath, { readonly: true });
    expect(verify.query<{ content: string }, []>("SELECT content FROM configs WHERE id = 'cfg-1'").get()?.content).toBe("do not overwrite");
    expect(verify.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM config_snapshots").get()?.count).toBe(0);
    verify.close();
  });

  test("refuses to overwrite an existing backup before changing destination", () => {
    const paths = fixture();
    createLegacy(paths.sourcePath);
    createCurrent(paths.destinationPath);
    Bun.write(paths.backupPath, "existing protected backup");

    expect(() => migrateLegacyInstructionsStore({ ...paths, ...operatorOptions, dryRun: false }))
      .toThrow("refuses to overwrite an existing destination backup");
    const verify = new Database(paths.destinationPath, { readonly: true });
    expect(verify.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM configs").get()?.count).toBe(0);
    verify.close();
    expect(readFileSync(paths.backupPath, "utf8")).toBe("existing protected backup");
  });

  test("requires an explicit local operator confirmation and rolls back destination writes on failure", () => {
    const paths = fixture();
    createLegacy(paths.sourcePath);
    createCurrent(paths.destinationPath);
    expect(() => migrateLegacyInstructionsStore({ ...paths, dryRun: true, operatorConfirmed: false }))
      .toThrow("explicit local operator confirmation");

    const db = new Database(paths.destinationPath);
    db.exec(`CREATE TRIGGER reject_snapshots BEFORE INSERT ON config_snapshots BEGIN SELECT RAISE(ABORT, 'fixture rejection'); END;`);
    db.close();
    let failure: unknown;
    try {
      migrateLegacyInstructionsStore({ ...paths, ...operatorOptions, dryRun: false });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(LegacyStoreMigrationError);
    expect((failure as Error).message).not.toContain("fixture rejection");
    const verify = new Database(paths.destinationPath, { readonly: true });
    expect(verify.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM configs").get()?.count).toBe(0);
    verify.close();
    expect(readFileSync(paths.backupPath).byteLength).toBeGreaterThan(0);
  });
});
