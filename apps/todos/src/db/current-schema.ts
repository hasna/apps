import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import {
  CURRENT_SCHEMA_HASH,
  CURRENT_SCHEMA_ID,
  CURRENT_SCHEMA_SQL,
  CURRENT_SCHEMA_VERSION,
} from "./current-schema.generated.js";

export {
  CURRENT_SCHEMA_HASH,
  CURRENT_SCHEMA_ID,
  CURRENT_SCHEMA_VERSION,
};

export const SCHEMA_UPGRADE_REQUIRED_CODE = "TODOS_SCHEMA_UPGRADE_REQUIRED" as const;
export const SCHEMA_STATE_AMBIGUOUS_CODE = "TODOS_SCHEMA_STATE_AMBIGUOUS" as const;

const FTS_SHADOW_TABLES = new Set([
  "tasks_fts_data",
  "tasks_fts_idx",
  "tasks_fts_content",
  "tasks_fts_docsize",
  "tasks_fts_config",
]);

interface SchemaSqlRow {
  type: string;
  name: string;
  sql: string;
}

interface CurrentMarkerRow {
  singleton: number;
  schema_id: string;
  schema_hash: string;
}

export type LocalSchemaState =
  | { kind: "empty" }
  | { kind: "current"; schema_id: typeof CURRENT_SCHEMA_ID; schema_hash: typeof CURRENT_SCHEMA_HASH }
  | { kind: "historical"; migration_level: number }
  | { kind: "ambiguous"; reason: string };

export class SchemaUpgradeRequiredError extends Error {
  readonly code = SCHEMA_UPGRADE_REQUIRED_CODE;
  readonly schemaId = CURRENT_SCHEMA_ID;
  readonly migrationLevel: number;

  constructor(migrationLevel: number) {
    super(
      `Local todos schema ${migrationLevel || "pre-versioned"} requires the detached offline upgrader for ${CURRENT_SCHEMA_ID}; the runtime did not modify it.`,
    );
    this.name = "SchemaUpgradeRequiredError";
    this.migrationLevel = migrationLevel;
  }
}

export class AmbiguousSchemaStateError extends Error {
  readonly code = SCHEMA_STATE_AMBIGUOUS_CODE;

  constructor(reason: string) {
    super(`Refusing ambiguous local todos schema: ${reason}`);
    this.name = "AmbiguousSchemaStateError";
  }
}

function isOptionalSchemaObject(name: string): boolean {
  return name === "_todos_schema"
    || name.startsWith("shadow_")
    || FTS_SHADOW_TABLES.has(name);
}

function canonicalSchema(rows: SchemaSqlRow[]): string {
  return rows
    .filter((row) => !isOptionalSchemaObject(row.name))
    .map((row) => `${row.type}\0${row.name}\0${row.sql.replace(/\s+/g, " ").trim()}`)
    .sort()
    .join("\n");
}

export function calculateCurrentSchemaHash(db: Database): string {
  const rows = db.query(`
    SELECT type, name, sql
    FROM sqlite_schema
    WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
  `).all() as SchemaSqlRow[];
  return createHash("sha256").update(canonicalSchema(rows)).digest("hex");
}

function tableExists(db: Database, name: string): boolean {
  return Boolean(db.query(
    "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = ?",
  ).get(name));
}

function readHistoricalMigrationLevel(db: Database): LocalSchemaState {
  if (!tableExists(db, "_migrations")) {
    return { kind: "ambiguous", reason: "non-empty store has no _todos_schema or _migrations marker" };
  }

  let rows: Array<{ id: unknown }>;
  try {
    rows = db.query("SELECT id FROM _migrations ORDER BY id").all() as Array<{ id: unknown }>;
  } catch {
    return { kind: "ambiguous", reason: "_migrations cannot be read" };
  }

  const ids = rows.map((row) => Number(row.id));
  // Historical migration 67 accidentally recorded checkpoint 66. A clean v68
  // store therefore has 1..66,68; that exact, documented shape is supported.
  // Every other gap or out-of-range id is ambiguous and is refused.
  const expected = ids.at(-1) === CURRENT_SCHEMA_VERSION
    ? [...Array.from({ length: 66 }, (_, index) => index + 1), CURRENT_SCHEMA_VERSION]
    : Array.from({ length: ids.at(-1) ?? 0 }, (_, index) => index + 1);
  const valid = ids.length > 0
    && ids.length === expected.length
    && ids.every((id, index) => Number.isInteger(id) && id === expected[index]);
  if (!valid) {
    return { kind: "ambiguous", reason: "historical migration ids are missing, duplicated, or out of range" };
  }
  return { kind: "historical", migration_level: ids.at(-1)! };
}

export function inspectLocalSchema(db: Database): LocalSchemaState {
  const objectCount = db.query(`
    SELECT COUNT(*) AS count
    FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
  `).get() as { count: number };
  if (objectCount.count === 0) return { kind: "empty" };

  if (!tableExists(db, "_todos_schema")) return readHistoricalMigrationLevel(db);

  let markers: CurrentMarkerRow[];
  try {
    markers = db.query(
      "SELECT singleton, schema_id, schema_hash FROM _todos_schema ORDER BY singleton",
    ).all() as CurrentMarkerRow[];
  } catch {
    return { kind: "ambiguous", reason: "current schema marker has an unreadable shape" };
  }
  if (markers.length !== 1 || markers[0]?.singleton !== 1) {
    return { kind: "ambiguous", reason: "current schema marker is missing or non-unique" };
  }
  const marker = markers[0];
  if (marker.schema_id !== CURRENT_SCHEMA_ID || marker.schema_hash !== CURRENT_SCHEMA_HASH) {
    return { kind: "ambiguous", reason: `unknown current schema marker ${marker.schema_id}` };
  }

  const migrationRows = tableExists(db, "_migrations")
    ? db.query("SELECT id FROM _migrations ORDER BY id").all() as Array<{ id: number }>
    : [];
  if (migrationRows.length !== 1 || migrationRows[0]?.id !== CURRENT_SCHEMA_VERSION) {
    return { kind: "ambiguous", reason: "current store does not have the single canonical schema checkpoint" };
  }
  const userVersion = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (userVersion !== CURRENT_SCHEMA_VERSION) {
    return { kind: "ambiguous", reason: `PRAGMA user_version is ${userVersion}, expected ${CURRENT_SCHEMA_VERSION}` };
  }

  const actualHash = calculateCurrentSchemaHash(db);
  if (actualHash !== CURRENT_SCHEMA_HASH) {
    return { kind: "ambiguous", reason: `schema hash ${actualHash} does not match ${CURRENT_SCHEMA_HASH}` };
  }
  return { kind: "current", schema_id: CURRENT_SCHEMA_ID, schema_hash: CURRENT_SCHEMA_HASH };
}

export function assertCurrentSchema(db: Database): void {
  const state = inspectLocalSchema(db);
  if (state.kind === "current") return;
  if (state.kind === "historical") throw new SchemaUpgradeRequiredError(state.migration_level);
  if (state.kind === "empty") {
    throw new AmbiguousSchemaStateError("an empty store has not been initialized");
  }
  throw new AmbiguousSchemaStateError(state.reason);
}

export function createCurrentSchema(db: Database): void {
  const state = inspectLocalSchema(db);
  if (state.kind === "current") return;
  if (state.kind === "historical") throw new SchemaUpgradeRequiredError(state.migration_level);
  if (state.kind === "ambiguous") throw new AmbiguousSchemaStateError(state.reason);

  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(CURRENT_SCHEMA_SQL);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* transaction did not start */ }
    throw error;
  }
  assertCurrentSchema(db);
}
