import type { Database } from "bun:sqlite";
import { getDatabase } from "../db/database.js";
import { SqliteTaskToPrProjectionStore } from "./local-sqlite.js";

export * from "./types.js";
export * from "./local-sqlite.js";
export * from "./remote.js";

export function createLocalTaskToPrProjectionStore(
  db: Database = getDatabase(),
): SqliteTaskToPrProjectionStore {
  return new SqliteTaskToPrProjectionStore(db);
}
