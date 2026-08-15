/**
 * SQLite executor for the shared referential-integrity conditions.
 *
 * The condition list, the severity rules and the verdict all live in
 * `src/lib/integrity.ts` — this file only runs the SQLite rendering of each
 * condition and wraps the rows. Keeping the semantics in one place is what stops
 * a condition from being implemented for SQLite while a Postgres-backed
 * deployment silently reports healthy.
 */
import type { Database } from "bun:sqlite";
import { getDatabase, now } from "./database.js";
import {
  buildSqliteIntegritySql,
  buildIntegrityReport,
  INTEGRITY_CONDITIONS,
  measuredCondition,
  unverifiedCondition,
  type IntegrityCondition,
  type IntegrityReport,
} from "../lib/integrity.js";

const REQUIRED_TABLES: Record<string, true> = { tasks: true, task_lists: true, projects: true };

function tableExists(db: Database, table: string): boolean {
  return Boolean(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

/**
 * Count every integrity condition against a local SQLite database.
 *
 * A missing table makes its conditions UNVERIFIED rather than zero: a database
 * that predates `task_lists` has not been shown to be clean, it has only been
 * shown to be unmeasurable.
 */
export function scanSqliteIntegrity(db: Database = getDatabase()): IntegrityReport {
  const missing = Object.keys(REQUIRED_TABLES).filter((table) => !tableExists(db, table));
  const conditions: IntegrityCondition[] = INTEGRITY_CONDITIONS.map((spec) => {
    if (missing.length > 0) {
      return unverifiedCondition(spec, `local schema is missing table(s): ${missing.join(", ")}`);
    }
    try {
      const row = db.query(buildSqliteIntegritySql(spec)).get() as
        { count: number | null; open_count: number | null } | undefined;
      return measuredCondition(
        spec,
        { count: Number(row?.count ?? 0), open_count: spec.entity === "task" ? Number(row?.open_count ?? 0) : null },
        "sqlite",
      );
    } catch (error) {
      // A query that cannot run is unverified, never clean.
      return unverifiedCondition(spec, error instanceof Error ? error.message : String(error));
    }
  });
  return buildIntegrityReport(conditions, now());
}
