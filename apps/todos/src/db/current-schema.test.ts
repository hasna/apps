import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  CURRENT_SCHEMA_HASH,
  CURRENT_SCHEMA_ID,
  CURRENT_SCHEMA_VERSION,
  SCHEMA_STATE_AMBIGUOUS_CODE,
  SCHEMA_UPGRADE_REQUIRED_CODE,
} from "./current-schema.js";
import { closeDatabase, getDatabase, resetDatabase } from "./database.js";
import { MIGRATIONS } from "./migrations.js";

let tempDir: string | null = null;

afterEach(() => {
  closeDatabase();
  resetDatabase();
  delete process.env["TODOS_DB_PATH"];
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function tempDatabase(): string {
  tempDir = mkdtempSync(join(tmpdir(), "todos-current-schema-"));
  return join(tempDir, "todos.db");
}

function fileHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("single current SQLite schema", () => {
  test("fresh runtime creation installs only the canonical current checkpoint", () => {
    const path = tempDatabase();
    process.env["TODOS_DB_PATH"] = path;

    const db = getDatabase();
    expect(db.query("SELECT schema_id, schema_hash FROM _todos_schema").get()).toEqual({
      schema_id: CURRENT_SCHEMA_ID,
      schema_hash: CURRENT_SCHEMA_HASH,
    });
    expect(db.query("SELECT id FROM _migrations ORDER BY id").all()).toEqual([{ id: CURRENT_SCHEMA_VERSION }]);
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: CURRENT_SCHEMA_VERSION });
  });

  test("normal runtime returns upgrade-required without mutating a historical store", () => {
    const path = tempDatabase();
    const legacy = new Database(path);
    legacy.exec(MIGRATIONS[0]!);
    legacy.query("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run("p1", "Legacy", "/legacy");
    legacy.query("INSERT INTO tasks (id, project_id, title) VALUES (?, ?, ?)").run("t1", "p1", "Preserve me");
    legacy.close();
    const before = fileHash(path);

    process.env["TODOS_DB_PATH"] = path;
    expect(() => getDatabase()).toThrow(expect.objectContaining({ code: SCHEMA_UPGRADE_REQUIRED_CODE }));
    expect(fileHash(path)).toBe(before);

    const verify = new Database(path, { readonly: true });
    expect(verify.query("SELECT title FROM tasks WHERE id = 't1'").get()).toEqual({ title: "Preserve me" });
    expect(verify.query("SELECT name FROM sqlite_schema WHERE name = '_todos_schema'").get()).toBeNull();
    expect(verify.query("SELECT id FROM _migrations").all()).toEqual([{ id: 1 }]);
    verify.close();
  });

  test("normal runtime fails closed on an ambiguous migration history", () => {
    const path = tempDatabase();
    const legacy = new Database(path);
    legacy.exec(MIGRATIONS[0]!);
    legacy.query("INSERT INTO _migrations (id) VALUES (3)").run();
    legacy.close();

    process.env["TODOS_DB_PATH"] = path;
    expect(() => getDatabase()).toThrow(expect.objectContaining({ code: SCHEMA_STATE_AMBIGUOUS_CODE }));
  });
});
