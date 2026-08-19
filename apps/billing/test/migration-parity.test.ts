// Sol-guided coverage (tests-coverage-sol workflow, 2026-08-19).
//
// Priority 3 — migration-contract parity. The SQLite schema (db/schema.ts)
// and the PostgreSQL migration plan (db/migration-plan.ts) must describe the
// SAME logical store: same tables, same columns (type family, nullability,
// default), same unique constraints, same indexes. Drift means the
// PostgreSQL backend serves a different shape than the SQLite one — queries,
// constraints, and money rows diverge per backend.
//
// Parsing notes, stated so the comparison is honest:
//  - Type families are normalized: INTEGER -> int, TEXT -> text,
//    TIMESTAMPTZ -> ts, and SQLite TEXT columns whose name follows the
//    timestamp convention (suffix _at, due_date, current_period_*) -> ts
//    (SQLite has no native timestamp type; the dialect difference is not a
//    schema difference).
//  - Defaults are normalized: now() and datetime('now') -> <time>.
//  - Inline column UNIQUE constraints are folded into the table's unique
//    set; PostgreSQL unique INDEXES are folded into their table's unique set
//    (the 0004 entity-scoped unique is expressed as an index).
//  - The 0004 migration explicitly DROPs the 0003 non-entity-scoped UNIQUE
//    constraint on accounting_reconciliation_events; the drop is applied
//    when parsing the final PostgreSQL state.
//  - Primary keys imply NOT NULL on both dialects.
//  - Foreign keys are NOT compared here (not in the Sol-scoped matrix).
//
// Measured red gap: the PostgreSQL plan is missing the six per-table
// entity_id indexes that SQLite declares (idx_customers_entity,
// idx_subscriptions_entity, idx_invoices_entity, idx_dunning_policies_entity,
// idx_dunning_runs_entity, idx_events_entity) — entity-scoped reads on the
// PostgreSQL backend full-scan without them.

import { describe, expect, it } from "bun:test";
import { POSTGRESQL_MIGRATIONS, migrationIds } from "../src/db/migration-plan.js";
import { SCHEMA } from "../src/db/schema.js";

const DOMAIN_TABLES = [
  "customers",
  "subscriptions",
  "invoices",
  "dunning_policies",
  "dunning_runs",
  "events",
  "audit_log",
  "accounting_reconciliation_events",
];

interface NormalizedColumn {
  type: string;
  notNull: boolean;
  default: string | null;
}
interface TableShape {
  columns: Map<string, NormalizedColumn>;
  uniques: string[]; // sorted column lists, e.g. "entity_id,source,source_id,event_type"
}
interface IndexShape {
  unique: boolean;
  columns: string[];
}

function normalizeType(raw: string, defaultRaw: string | null, name: string): string {
  const type = raw.toUpperCase();
  if (type.includes("TIMESTAMPTZ")) return "ts";
  if (type.includes("INTEGER") || type.includes("INT")) return "int";
  if (type.includes("TEXT") || type.includes("CHAR")) {
    if (defaultRaw && defaultRaw.includes("datetime(")) return "ts";
    if (/(_at$)|(^due_date$)|(^current_period_)/.test(name)) return "ts";
    return "text";
  }
  return type.toLowerCase();
}

function normalizeDefault(raw: string | null): string | null {
  if (raw === null) return null;
  const value = raw.trim().toLowerCase();
  if (value === "now()" || value.includes("datetime(")) return "<time>";
  return value.replace(/^\(/, "").replace(/\)$/, "");
}

/** Parse CREATE TABLE blocks from a SQL text blob. */
function parseTables(sql: string): Map<string, TableShape> {
  const tables = new Map<string, TableShape>();
  const blocks = sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+) \(([\s\S]*?)\);/g);
  for (const match of blocks) {
    const name = match[1]!;
    const body = match[2]!;
    const shape: TableShape = { columns: new Map(), uniques: [] };
    for (const line of body.split(/\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const entry = trimmed.replace(/,$/, "").trim();
      if (/^UNIQUE\s*\(/.test(entry)) {
        const cols = entry.replace(/^UNIQUE\s*\(/, "").replace(/\)$/, "");
        shape.uniques.push(cols.split(",").map((c) => c.trim()).join(","));
        continue;
      }
      const colMatch = entry.match(/^(\w+)\s+(.+)$/);
      if (!colMatch) continue; // CHECK/FK-only lines ignored
      const colName = colMatch[1]!;
      let afterDefault = colMatch[2]!.trim();
      let defaultRaw: string | null = null;
      const defaultIdx = afterDefault.search(/\bDEFAULT\b/i);
      if (defaultIdx >= 0) {
        defaultRaw = afterDefault.slice(defaultIdx + "DEFAULT".length).trim();
        afterDefault = afterDefault.slice(0, defaultIdx);
      }
      const inlineUnique = /\bUNIQUE\b/i.test(afterDefault);
      const notNull = /\bNOT NULL\b/i.test(afterDefault) || /\bPRIMARY KEY\b/i.test(afterDefault);
      const typeRaw = afterDefault
        .replace(/\b(?:PRIMARY KEY|NOT NULL|UNIQUE|REFERENCES\s+\w+\s*\([^)]*\))\b/gi, " ")
        .trim();
      if (!typeRaw) continue;
      shape.columns.set(colName, {
        type: normalizeType(typeRaw, defaultRaw, colName),
        notNull,
        default: normalizeDefault(defaultRaw),
      });
      if (inlineUnique) shape.uniques.push(colName);
    }
    shape.uniques.sort();
    tables.set(name, shape);
  }
  return tables;
}

/** Parse CREATE [UNIQUE] INDEX statements from a SQL text blob. */
function parseIndexes(sql: string): Map<string, IndexShape> {
  const indexes = new Map<string, IndexShape>();
  const blocks = sql.matchAll(/CREATE (UNIQUE )?INDEX (?:IF NOT EXISTS )?(\w+)\s+ON\s+(\w+)\s*\(([^)]+)\)/g);
  for (const match of blocks) {
    const unique = match[1] !== undefined;
    const indexName = match[2]!;
    const columns = match[4]!.split(",").map((c) => c.trim());
    indexes.set(indexName, { unique, columns });
  }
  return indexes;
}

/** Final PostgreSQL state: apply all migrations in order. */
function postgresqlFinalState(): { tables: Map<string, TableShape>; indexes: Map<string, IndexShape> } {
  const tables = new Map<string, TableShape>();
  const indexes = new Map<string, IndexShape>();
  const droppedConstraints = new Map<string, Set<string>>();
  for (const migration of POSTGRESQL_MIGRATIONS) {
    for (const drop of migration.sql.matchAll(/ALTER TABLE (\w+) DROP CONSTRAINT (?:IF EXISTS )?([\w]+);/g)) {
      const table = drop[1]!;
      if (!droppedConstraints.has(table)) droppedConstraints.set(table, new Set());
      droppedConstraints.get(table)!.add(drop[2]!);
    }
    for (const [name, shape] of parseTables(migration.sql)) {
      const merged = tables.get(name);
      if (!merged) {
        tables.set(name, shape);
      } else {
        for (const [col, norm] of shape.columns) merged.columns.set(col, norm);
        merged.uniques.push(...shape.uniques);
        merged.uniques.sort();
      }
    }
    for (const [name, shape] of parseIndexes(migration.sql)) indexes.set(name, shape);
  }
  // Apply 0004's entity-scoped-unique replacement: drop the 0003 inline UNIQUE
  // on accounting_reconciliation_events; the unique INDEX of 0004 replaces it.
  const recon = tables.get("accounting_reconciliation_events");
  if (recon) {
    recon.uniques = recon.uniques.filter((u) => u !== "source,source_id,event_type");
  }
  // Fold unique indexes into their table's unique set (0004's replacement).
  for (const [indexName, shape] of indexes) {
    if (!shape.unique) continue;
    const tableName = indexName.replace(/^uq_/, "").replace(/_source$/, "") || "";
    const target = indexName === "uq_accounting_reconciliation_entity_source" ? "accounting_reconciliation_events" : "";
    const owner = tables.get(target || tableName) ?? null;
    if (owner) {
      owner.uniques.push(shape.columns.join(","));
      owner.uniques.sort();
    }
  }
  return { tables, indexes };
}

function sqliteFinalState(): { tables: Map<string, TableShape>; indexes: Map<string, IndexShape> } {
  return { tables: parseTables(SCHEMA), indexes: parseIndexes(SCHEMA) };
}

describe("postgresql migration plan integrity", () => {
  it("keeps migration ids unique and forward ordered", () => {
    const ids = POSTGRESQL_MIGRATIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
    // Zero-padded numeric prefixes keep lexicographic order == numeric order.
    expect(ids[0]).toMatch(/^0001/);
  });

  it("migrationIds() matches the migration plan exactly", () => {
    expect(migrationIds()).toEqual(POSTGRESQL_MIGRATIONS.map((m) => m.id));
  });
});

describe("sqlite/postgresql schema parity", () => {
  const pg = postgresqlFinalState();
  const sqlite = sqliteFinalState();

  const pgTables = new Map([...pg.tables].filter(([name]) => DOMAIN_TABLES.includes(name)));
  const sqliteTables = new Map([...sqlite.tables].filter(([name]) => DOMAIN_TABLES.includes(name)));

  it("declares the same domain tables (SQLite also carries schema_migrations, its own ledger)", () => {
    expect([...sqliteTables.keys()].sort()).toEqual([...DOMAIN_TABLES].sort());
    expect([...pgTables.keys()].sort()).toEqual([...DOMAIN_TABLES].sort());
  });

  it("matches every table's columns (type family, nullability, default)", () => {
    for (const table of DOMAIN_TABLES) {
      const pgShape = pgTables.get(table);
      const sqliteShape = sqliteTables.get(table);
      expect(pgShape, `postgresql missing table ${table}`).toBeDefined();
      expect(sqliteShape, `sqlite missing table ${table}`).toBeDefined();
      const pgCols = [...(pgShape!.columns.keys())].sort();
      const sqliteCols = [...(sqliteShape!.columns.keys())].sort();
      expect(pgCols, `column name drift on ${table}`).toEqual(sqliteCols);
      for (const col of pgCols) {
        const a = pgShape!.columns.get(col)!;
        const b = sqliteShape!.columns.get(col)!;
        expect(a, `postgresql column ${table}.${col}`).toEqual(b);
      }
    }
  });

  it("matches the unique-constraint sets", () => {
    for (const table of DOMAIN_TABLES) {
      const pgUniques = pgTables.get(table)!.uniques;
      const sqliteUniques = sqliteTables.get(table)!.uniques;
      expect([...pgUniques].sort(), `unique drift on ${table}`).toEqual([...sqliteUniques].sort());
    }
  });

  it("matches the non-unique index set (name -> columns)", () => {
    // Unique constraints are compared via the unique-constraint sets above;
    // only non-unique indexes are compared here (SQLite expresses uniqueness
    // as a table constraint, PostgreSQL as a unique index — same semantics,
    // different shape, compared in the unique test).
    // Measured red: SQLite declares seven entity indexes; the PostgreSQL plan
    // declares only idx_accounting_reconciliation_entity — six entity indexes
    // are missing on PostgreSQL.
    const pgIndexes = new Map([...pg.indexes].filter(([, shape]) => !shape.unique).map(([name, shape]) => [name, shape.columns]));
    const sqliteIndexes = new Map([...sqlite.indexes].filter(([, shape]) => !shape.unique).map(([name, shape]) => [name, shape.columns]));

    for (const [name, columns] of sqliteIndexes) {
      expect(pgIndexes.get(name), `postgresql missing index ${name} (${columns.join(",")})`).toEqual(columns);
    }
    for (const [name, columns] of pgIndexes) {
      expect(sqliteIndexes.get(name), `sqlite missing index ${name}`).toEqual(columns);
    }
  });
});
