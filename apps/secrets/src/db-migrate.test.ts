import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Database } from "bun:sqlite";
import { getDb, closeDb } from "./db.js";

const rootDir = join(import.meta.dir, "..");

describe("legacy dotfile migration", () => {
  it("copies only service-owned files and leaves the ~/.secrets credential store alone", () => {
    const home = mkdtempSync(join(tmpdir(), "secrets-dotfile-home-"));
    const legacyDir = join(home, ".secrets");
    const targetDir = join(home, ".hasna", "secrets");
    const credentialDir = join(legacyDir, "example", "app");
    mkdirSync(credentialDir, { recursive: true });
    // The target commonly exists before first run because postinstall creates it.
    mkdirSync(targetDir, { recursive: true });

    const legacyDb = new Database(join(legacyDir, "vault.db"), { create: true });
    legacyDb.exec("CREATE TABLE migration_marker (value TEXT NOT NULL); INSERT INTO migration_marker VALUES ('preserved')");
    legacyDb.close();

    writeFileSync(join(legacyDir, "vault.key"), "legacy-key-fixture");
    writeFileSync(join(legacyDir, "kms.json"), '{"keyId":"fixture"}');
    writeFileSync(join(legacyDir, ".serve-token"), "legacy-token-fixture");
    writeFileSync(join(legacyDir, "aws.json"), '{"region":"legacy"}');
    writeFileSync(join(targetDir, "aws.json"), '{"region":"current"}');
    writeFileSync(join(credentialDir, "live.env"), "TOKEN=credential-store-fixture\n");
    writeFileSync(join(legacyDir, "unrelated.env"), "TOKEN=top-level-fixture\n");
    const linkedKey = join(home, "linked-key-fixture");
    writeFileSync(linkedKey, "linked-key-fixture");
    symlinkSync(linkedKey, join(legacyDir, "vault.key.enc"));

    try {
      const dbModule = pathToFileURL(join(rootDir, "src", "db.ts")).href;
      const code = [
        `const mod = await import(${JSON.stringify(dbModule)});`,
        "mod.getDb();",
        "mod.closeDb();",
      ].join("\n");
      const result = Bun.spawnSync({
        cmd: ["bun", "-e", code],
        cwd: rootDir,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home },
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
      const migratedDb = new Database(join(targetDir, "vault.db"));
      expect(migratedDb.query("SELECT value FROM migration_marker").get()).toEqual({ value: "preserved" });
      migratedDb.close();
      expect(readFileSync(join(targetDir, "vault.key"), "utf8")).toBe("legacy-key-fixture");
      expect(readFileSync(join(targetDir, "kms.json"), "utf8")).toBe('{"keyId":"fixture"}');
      expect(readFileSync(join(targetDir, ".serve-token"), "utf8")).toBe("legacy-token-fixture");
      expect(readFileSync(join(targetDir, "aws.json"), "utf8")).toBe('{"region":"current"}');

      expect(existsSync(join(targetDir, "example", "app", "live.env"))).toBe(false);
      expect(existsSync(join(targetDir, "unrelated.env"))).toBe(false);
      expect(existsSync(join(targetDir, "vault.key.enc"))).toBe(false);
      expect(readFileSync(join(credentialDir, "live.env"), "utf8")).toBe("TOKEN=credential-store-fixture\n");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);

  it("does not copy legacy SQLite sidecars when target vault.db already exists", () => {
    const home = mkdtempSync(join(tmpdir(), "secrets-dotfile-home-"));
    const legacyDir = join(home, ".secrets");
    const targetDir = join(home, ".hasna", "secrets");
    mkdirSync(legacyDir, { recursive: true });
    mkdirSync(targetDir, { recursive: true });

    const legacyDb = new Database(join(legacyDir, "vault.db"), { create: true });
    legacyDb.exec("CREATE TABLE migration_marker (value TEXT NOT NULL); INSERT INTO migration_marker VALUES ('legacy')");
    legacyDb.close();

    const targetDb = new Database(join(targetDir, "vault.db"), { create: true });
    targetDb.exec("CREATE TABLE migration_marker (value TEXT NOT NULL); INSERT INTO migration_marker VALUES ('current')");
    targetDb.close();

    for (const name of ["vault.db-wal", "vault.db-shm", "vault.db-journal"]) {
      writeFileSync(join(legacyDir, name), `${name}-legacy-fixture`);
    }

    try {
      const dataDirModule = pathToFileURL(join(rootDir, "src", "data-dir.ts")).href;
      const code = [
        `const mod = await import(${JSON.stringify(dataDirModule)});`,
        "mod.ensureOperatorDataDir();",
      ].join("\n");
      const result = Bun.spawnSync({
        cmd: ["bun", "-e", code],
        cwd: rootDir,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home },
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
      for (const name of ["vault.db-wal", "vault.db-shm", "vault.db-journal"]) {
        expect(existsSync(join(targetDir, name))).toBe(false);
      }

      const currentDb = new Database(join(targetDir, "vault.db"));
      expect(currentDb.query("SELECT value FROM migration_marker").get()).toEqual({ value: "current" });
      currentDb.close();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);
});

// Regression: legacy vaults shipped a feedback table with `service TEXT NOT NULL`
// (no default) and an `id` without a generator default. Canonical inserts omit
// both, so they failed with "NOT NULL constraint failed: feedback.service" until
// the migration rebuilds the table. Covers CLI `feedback` and MCP `send_feedback`.
describe("legacy feedback table migration", () => {
  const dirs: string[] = [];
  afterEach(() => {
    closeDb();
    delete process.env.HASNA_SECRETS_DB_PATH;
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function seedLegacy(): string {
    const dir = mkdtempSync(join(tmpdir(), "secrets-legacy-"));
    dirs.push(dir);
    const path = join(dir, "vault.db");
    const db = new Database(path);
    db.exec(`
      CREATE TABLE feedback (
        id TEXT PRIMARY KEY,
        service TEXT NOT NULL,
        version TEXT DEFAULT '',
        message TEXT NOT NULL,
        email TEXT DEFAULT '',
        machine_id TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    db.run(
      "INSERT INTO feedback (id, service, version, message, email) VALUES (?, ?, ?, ?, ?)",
      ["row-1", "secrets", "0.1.0", "old feedback", "a@b.co"],
    );
    db.close();
    return path;
  }

  it("rebuilds the table, preserves rows, drops service, and unblocks canonical inserts", () => {
    process.env.HASNA_SECRETS_DB_PATH = seedLegacy();
    const db = getDb();

    const cols = (db.prepare("PRAGMA table_info(feedback)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).not.toContain("service");
    expect(cols).toContain("category");

    // pre-existing row survived the rebuild
    const migrated = db.prepare("SELECT id, message, email, version FROM feedback WHERE id = ?").get("row-1") as
      | { id: string; message: string; email: string; version: string }
      | undefined;
    expect(migrated?.message).toBe("old feedback");
    expect(migrated?.email).toBe("a@b.co");

    // the previously-failing canonical insert (id + service omitted) now works
    expect(() =>
      db.run("INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)", [
        "new feedback",
        null,
        "general",
        "0.2.4",
      ]),
    ).not.toThrow();
    expect((db.prepare("SELECT COUNT(*) c FROM feedback").get() as { c: number }).c).toBe(2);
  });

  it("is a no-op on an already-canonical table", () => {
    const dir = mkdtempSync(join(tmpdir(), "secrets-canon-"));
    dirs.push(dir);
    process.env.HASNA_SECRETS_DB_PATH = join(dir, "vault.db");
    getDb(); // first init creates canonical schema
    closeDb();
    // second init must not throw and must keep canonical inserts working
    const db = getDb();
    expect(() =>
      db.run("INSERT INTO feedback (message, category, version) VALUES (?, ?, ?)", ["hi", "general", "0.2.4"]),
    ).not.toThrow();
  });
});
