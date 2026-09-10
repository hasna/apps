import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS } from "./migrations.js";
import {
  AGENT_IDENTITY_HISTORY_TRIGGER_DDL,
  ensureAgentIdentitySchema,
} from "./identity-mapping.js";

/**
 * Regression: `todos --json agents` failed on databases that already carried
 * `trg_agent_identity_mapping_history_immutable` with
 *
 *   SQLiteError: trigger trg_agent_identity_mapping_history_immutable already exists
 *
 * The repair block in `ensureAgentIdentitySchema` created that trigger with a
 * bare `CREATE TRIGGER`. It was only safe because a `DROP TRIGGER IF EXISTS`
 * sits on the line above it — so the CREATE was not idempotent on its own, and
 * any path that reached the CREATE without the DROP (a partially-applied
 * migration 65, a retried/aborted exec, or a future refactor that moves or
 * removes the DROP) reproduced the failure. The DDL is now
 * `CREATE TRIGGER IF NOT EXISTS`, which is idempotent regardless of the DROP.
 *
 * These tests run the initialiser twice and run the guarded DDL twice.
 */

describe("agent identity history-trigger idempotency", () => {
  let dir: string | null = null;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "todos-identity-trigger-"));
  });

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  function databasePath(name = "todos.db"): string {
    if (!dir) throw new Error("temp dir not initialised");
    return join(dir, name);
  }

  /** A database as it exists once migration 65 has run: the trigger is present. */
  function databaseAfterMigration65(path: string): Database {
    const db = new Database(path);
    for (const migration of MIGRATIONS.slice(0, 65)) db.exec(migration);
    return db;
  }

  function historyTriggerSql(db: Database): string | null {
    const row = db
      .query("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?")
      .get("trg_agent_identity_mapping_history_immutable") as { sql: string } | null;
    return row ? row.sql : null;
  }

  it("guards both history triggers with IF NOT EXISTS so a second CREATE is a no-op", () => {
    // The shipped DDL must not depend on the initialiser's DROP to be safe.
    expect(AGENT_IDENTITY_HISTORY_TRIGGER_DDL).toContain(
      "CREATE TRIGGER IF NOT EXISTS trg_agent_identity_mapping_history_immutable",
    );
    expect(AGENT_IDENTITY_HISTORY_TRIGGER_DDL).toContain(
      "CREATE TRIGGER IF NOT EXISTS trg_agent_identity_mapping_history_append_only",
    );
    expect(AGENT_IDENTITY_HISTORY_TRIGGER_DDL).not.toMatch(
      /CREATE TRIGGER trg_agent_identity_mapping_history/,
    );
  });

  it("executes the history-trigger DDL twice against an existing trigger without error", () => {
    const db = databaseAfterMigration65(databasePath());
    try {
      // The database already carries the triggers from migration 65, and the
      // DDL is executed without the initialiser's DROP in front of it: this is
      // the exact shape that produced "trigger ... already exists".
      expect(historyTriggerSql(db)).not.toBeNull();

      db.exec(AGENT_IDENTITY_HISTORY_TRIGGER_DDL);
      db.exec(AGENT_IDENTITY_HISTORY_TRIGGER_DDL);

      const count = db
        .query("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = ?")
        .get("trg_agent_identity_mapping_history_immutable") as { count: number };
      expect(count.count).toBe(1);
    } finally {
      db.close();
    }
  });

  it("runs the initialiser twice against a database that already carries the trigger", () => {
    const db = databaseAfterMigration65(databasePath());
    try {
      expect(historyTriggerSql(db)).not.toBeNull();

      // Second full application of the repair over an already-initialised
      // database: this is what surfaced as "trigger ... already exists".
      expect(() => ensureAgentIdentitySchema(db)).not.toThrow();
      expect(() => ensureAgentIdentitySchema(db)).not.toThrow();

      const count = db
        .query("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = ?")
        .get("trg_agent_identity_mapping_history_immutable") as { count: number };
      expect(count.count).toBe(1);
    } finally {
      db.close();
    }
  });

  it("keeps the drop-and-recreate upgrade path: a stale definition is replaced", () => {
    const db = databaseAfterMigration65(databasePath());
    try {
      db.exec("DROP TRIGGER IF EXISTS trg_agent_identity_mapping_history_immutable");
      db.exec(
        "CREATE TRIGGER trg_agent_identity_mapping_history_immutable"
        + " BEFORE UPDATE OF local_agent_id ON agent_identity_source_mappings"
        + " BEGIN SELECT RAISE(ABORT, 'STALE_DEFINITION'); END;",
      );

      ensureAgentIdentitySchema(db);

      const sql = historyTriggerSql(db);
      expect(sql).not.toBeNull();
      expect(sql).not.toContain("STALE_DEFINITION");
      expect(sql).toContain("IDENTITY_MAPPING_HISTORY_IMMUTABLE");
    } finally {
      db.close();
    }
  });

  it("still enforces append-only history after a repeated initialisation", () => {
    const db = databaseAfterMigration65(databasePath());
    try {
      ensureAgentIdentitySchema(db);
      ensureAgentIdentitySchema(db);

      db.exec(
        "INSERT INTO agent_identity_source_mappings ("
        + " id, local_agent_id, identity_id, source_authority, source_tenant_id,"
        + " source_namespace, source_entity_type, source_record_id, observed_label,"
        + " evidence, mapping_basis, status, revision, created_at, updated_at) VALUES"
        + " ('map-1', NULL, 'identity-1', 'github.com', 'hasna', 'accounts', 'user',"
        + " 'actor-1', 'label', '{}', 'authoritative', 'active', 1, '2026-01-01', '2026-01-01')",
      );

      expect(() =>
        db.run(
          "UPDATE agent_identity_source_mappings SET revision = 2 WHERE id = 'map-1'",
        ),
      ).toThrow("IDENTITY_MAPPING_HISTORY_IMMUTABLE");

      expect(() =>
        db.run("DELETE FROM agent_identity_source_mappings WHERE id = 'map-1'"),
      ).toThrow("IDENTITY_MAPPING_HISTORY_IMMUTABLE");
    } finally {
      db.close();
    }
  });
});
