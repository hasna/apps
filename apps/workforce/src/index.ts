// Library entry for @hasna/workforce. Exports the domain types + service surface
// so other Hasna packages can compose the roster in-process.

export * from "./types/index.js";
export * from "./services/index.js";
export { APP_VERSION } from "./version.js";
export { openApiDocument, buildOpenApiDocument } from "./api/index.js";
export { buildApp } from "./server/app.js";
export { buildServer } from "./mcp/index.js";
export {
  APP_NAME,
  ENV_TOKEN,
  resolveStorageMode,
  resolveDbPath,
  databaseUrlPresent,
  type StorageMode,
} from "./config.js";
export { openDatabase, getDatabase, closeDatabase, resetDatabase } from "./db/database.js";
export { ROSTER_EXPORT_SCHEMA, type RosterExport } from "./services/exports.js";
