#!/usr/bin/env bun
/**
 * Maintainer-only generator for the immutable SQLite v68 schema snapshot.
 *
 * This lives with the detached upgrader so historical migration code never
 * becomes a dependency of a shipped entry point. It is not a package script,
 * export, or binary.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import { ensureAgentIdentitySchema } from "../../../src/db/identity-mapping.js";
import { runMigrations } from "../../../src/db/schema.js";

const SCHEMA_ID = "todos.sqlite.v68";
const outputPath = resolve(import.meta.dir, "../../../src/db/current-schema.generated.ts");
const ftsShadowTables = new Set([
  "tasks_fts_data",
  "tasks_fts_idx",
  "tasks_fts_content",
  "tasks_fts_docsize",
  "tasks_fts_config",
]);

interface SchemaRow {
  type: string;
  name: string;
  sql: string;
}

function canonicalSchema(rows: SchemaRow[]): string {
  return rows
    .map((row) => `${row.type}\0${row.name}\0${row.sql.replace(/\s+/g, " ").trim()}`)
    .sort()
    .join("\n");
}

const db = new Database(":memory:");
db.run("PRAGMA foreign_keys = ON");
runMigrations(db);
ensureAgentIdentitySchema(db);

const rows = (db.query(`
  SELECT type, name, sql
  FROM sqlite_schema
  WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
  ORDER BY rowid
`).all() as SchemaRow[]).filter((row) => !ftsShadowTables.has(row.name));

const schemaHash = createHash("sha256").update(canonicalSchema(rows)).digest("hex");
const statements = rows.map((row) => `${row.sql.trim().replace(/;$/, "")};`);
statements.push(
  `DELETE FROM _migrations;`,
  `INSERT INTO _migrations (id) VALUES (68);`,
  `CREATE TABLE _todos_schema (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    schema_id TEXT NOT NULL,
    schema_hash TEXT NOT NULL,
    installed_at TEXT NOT NULL
  );`,
  `INSERT INTO _todos_schema (singleton, schema_id, schema_hash, installed_at)
   VALUES (1, '${SCHEMA_ID}', '${schemaHash}', datetime('now'));`,
  `PRAGMA user_version = 68;`,
);

const source = `/* eslint-disable */
/**
 * GENERATED FILE. The normal runtime executes this one current-schema snapshot;
 * it never imports or walks the historical migration chain.
 *
 * Regenerate only with tools/schema-upgrader/v68/generate-current-schema.ts.
 */
export const CURRENT_SCHEMA_ID = ${JSON.stringify(SCHEMA_ID)} as const;
export const CURRENT_SCHEMA_VERSION = 68 as const;
export const CURRENT_SCHEMA_HASH = ${JSON.stringify(schemaHash)} as const;
export const CURRENT_SCHEMA_SQL = ${JSON.stringify(statements.join("\n\n"))};
`;

writeFileSync(outputPath, source);
db.close();
console.log(`generated ${outputPath} (${rows.length} schema objects, sha256 ${schemaHash})`);
