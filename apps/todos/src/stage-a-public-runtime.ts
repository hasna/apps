/**
 * Single production owner for every Stage A public wrapper that can observe a
 * SQLite capability. Building this graph once keeps constructor provenance,
 * database singletons, and cross-subpath dispatch in one module instance.
 */
import * as contractsRuntime from "./contracts.runtime.js";
import * as rootRuntime from "./index.runtime.js";
import * as storageRuntime from "./storage.runtime.js";
import * as localSqliteRuntime from "./storage/local-sqlite.js";
import * as sqliteSnapshotRuntime from "./storage/sqlite-snapshot-runtime.js";
import * as stageAPublicHelperRuntime from "./storage/stage-a-public-helper-runtime.js";
import { assertPublicSqliteBoundaryArguments } from "./db/database.js";

export const contracts = contractsRuntime;
export const localSqlite = localSqliteRuntime;
export const root = rootRuntime;
export const sqliteSnapshot = sqliteSnapshotRuntime;
export const stageAPublicHelpers = stageAPublicHelperRuntime;
export const storage = storageRuntime;
export { assertPublicSqliteBoundaryArguments };
