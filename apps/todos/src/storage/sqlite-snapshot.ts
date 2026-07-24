import { assertTodosLocalStorageRole } from "./config.js";
import { resolveTodosPublicRuntimeOwnerModulePath } from "./runtime-module-path.js";
import type {
  TodosStorageImportResult,
  TodosStorageSnapshot,
} from "./interfaces.js";

type Database = import("bun:sqlite").Database;

function loadSnapshotRuntime(): typeof import("./sqlite-snapshot-runtime.js") {
  assertTodosLocalStorageRole(process.env);
  const ownerPath = resolveTodosPublicRuntimeOwnerModulePath(import.meta.url);
  const owner = require(ownerPath) as typeof import("../stage-a-public-runtime.js");
  return owner.sqliteSnapshot;
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
