import { assertTodosLocalStorageRole } from "./config.js";
import { resolveTodosStorageRuntimeModulePath } from "./runtime-module-path.js";
import type {
  TodosStorageImportResult,
  TodosStorageSnapshot,
} from "./interfaces.js";

type Database = import("bun:sqlite").Database;

function loadSnapshotRuntime(): typeof import("./sqlite-snapshot-runtime.js") {
  assertTodosLocalStorageRole(process.env);
  const runtimePath = resolveTodosStorageRuntimeModulePath(import.meta.url, "sqlite-snapshot-runtime");
  return require(runtimePath) as typeof import("./sqlite-snapshot-runtime.js");
}

export function exportSqliteTodosStorageSnapshot(db?: Database): TodosStorageSnapshot {
  assertTodosLocalStorageRole(process.env);
  return loadSnapshotRuntime().exportSqliteTodosStorageSnapshot(db);
}

export function importSqliteTodosStorageSnapshot(
  snapshot: TodosStorageSnapshot,
  db?: Database,
): TodosStorageImportResult {
  assertTodosLocalStorageRole(process.env);
  return loadSnapshotRuntime().importSqliteTodosStorageSnapshot(snapshot, db);
}
