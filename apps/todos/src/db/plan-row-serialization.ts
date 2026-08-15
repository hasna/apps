import type { Database } from "bun:sqlite";

/**
 * Acquire SQLite's writer reservation through the same plan rows used by the
 * guarded link transaction. This must run before membership or linkage state
 * is read so a writer cannot validate stale plan state and commit afterward.
 */
export function guardPlanRowsSqlite(planIds: readonly (string | null | undefined)[], db: Database): void {
  const ids = [...new Set(planIds.filter((id): id is string => Boolean(id)))].sort();
  for (const id of ids) {
    db.run(
      "/* todos:sqlite-plan-row-guard */ UPDATE plans SET id = id WHERE id = ?",
      [id],
    );
  }
}
