// @hasna/holdings — library entry. Re-exports the domain types + service surface so the
// package can be embedded as an SDK in addition to its CLI/MCP/serve bins.

export { APP_VERSION } from "./version.js";
export * from "./types/index.js";
export * from "./services/index.js";
export { openDatabase, migrationsApplied } from "./db/database.js";
export { appendAudit, listAudit, verifyAuditChain } from "./db/audit.js";
export { SCHEMA, AUDIT_TABLES, SYNC_TABLES } from "./db/schema.js";
export {
  APP_NAME,
  ENV_TOKEN,
  DATABASE_URL_SECRET_REF,
  resolveStorageMode,
  resolveDbPath,
  databaseUrlPresent,
  type StorageMode,
} from "./config.js";
export { ensureHoldingsAppHome, getHoldingsAppHome } from "./core/app-home.js";
export { buildOpenApiDocument, openApiDocument, openApiDocumentJson } from "./api/index.js";
export { createApp } from "./server/app.js";
export { buildServer, shouldRegisterTool } from "./mcp/index.js";
export { apiScopes, type ApiScope, type ApiCredentialConfig, type ApiPrincipal } from "./server/auth.js";
