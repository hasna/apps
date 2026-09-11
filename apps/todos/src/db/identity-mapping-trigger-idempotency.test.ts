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
 * Pins the intrinsic idempotency of the agent-identity history-trigger DDL.
 *
 * The repair block in `ensureAgentIdentitySchema` created those triggers with a
 * bare `CREATE TRIGGER` and relied on a `DROP TRIGGER IF EXISTS` on the line
 * above it. The shipped path was already safe: the whole block runs inside
 * `install.immediate()` (`BEGIN IMMEDIATE`), so the DROP and CREATE are atomic
 * together and no other connection can get between them. `todos --json agents`
 * could NOT be made to fail with
 *
 *   SQLiteError: trigger trg_agent_identity_mapping_history_immutable already exists
 *
 * from current `main`, and these tests do not claim otherwise. What was wrong
 * is the shape — the CREATE was not idempotent on its own, so the block's
 * safety rested on statement adjacency and on nobody ever reaching the CREATE
 * without the DROP. `CREATE TRIGGER IF NOT EXISTS` removes that dependency.
 *
 * The tests therefore pin the guarantee rather than a reproduction: the DDL is
 * safe to execute against a database that already carries the triggers, and the
 * shipped initialiser is safe across the partially-applied states it exists to
 * repair. Both fail on the pre-fix DDL (bare `CREATE TRIGGER`).
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
      // the shape the pre-fix bare `CREATE TRIGGER` could not survive.
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
      // database. This already passed on the pre-fix source — the DROP masks
      // the bare CREATE — so it is pinned as the shipped-path guard it is, not
      // as a reproduction.
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

  it("repairs the partially-applied states it exists for, without throwing", () => {
    // ensureAgentIdentitySchema is a repair for a half-applied migration 65,
    // so the states below are the ones it can actually meet. Each is built on
    // a database that already has the base schema (migrations 1-65), and each
    // runs the real initialiser twice.
    const states: Array<[string, () => Database]> = [
      [
        "the trigger is already present",
        () => databaseAfterMigration65(databasePath("state-present.db")),
      ],
      [
        "the repair ledger entry was lost",
        () => {
          const db = databaseAfterMigration65(databasePath("state-lost-ledger.db"));
          db.exec("DELETE FROM _migrations WHERE CAST(id AS TEXT) = '65'");
          return db;
        },
      ],
      [
        "the history indexes were dropped",
        () => {
          const db = databaseAfterMigration65(databasePath("state-dropped-index.db"));
          db.exec("DROP INDEX IF EXISTS idx_agent_identity_source_revision_unique");
          db.exec("DROP INDEX IF EXISTS idx_agent_identity_source_identity");
          db.exec("DROP INDEX IF EXISTS idx_agent_identity_source_local");
          return db;
        },
      ],
      [
        "the alias table was dropped",
        () => {
          const db = databaseAfterMigration65(databasePath("state-dropped-alias.db"));
          db.exec("DROP TABLE IF EXISTS agent_identity_aliases");
          return db;
        },
      ],
    ];

    for (const [label, open] of states) {
      const db = open();
      try {
        expect(() => ensureAgentIdentitySchema(db), label).not.toThrow();
        expect(() => ensureAgentIdentitySchema(db), label).not.toThrow();
        expect(historyTriggerSql(db), label).not.toBeNull();
      } finally {
        db.close();
      }
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
