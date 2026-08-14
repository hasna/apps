// SDK barrel — import from "@hasna/consolidations" to reuse this app's domain.
export * from "./version.js";
export * from "./config.js";
export * from "./types/index.js";
export { openStore } from "./db/database.js";
export type { Store, Row, DataTable } from "./db/store.js";
export { verifyAuditChain, computeRowHash, canonical } from "./db/audit.js";
export { consolidate } from "./services/consolidate.js";
export type { ConsolidateInput, ConsolidateResult } from "./services/consolidate.js";
export { GROUP_COA, INTERCOMPANY_PAIRS } from "./services/group-coa.js";
export { seedDemo } from "./services/fixtures-seed.js";
export { OPS, getOp, parityOps } from "./services/registry.js";
export { executeOp, SYSTEM_PRINCIPAL } from "./services/execute.js";
export { apiScopes } from "./server/auth.js";
export type { ApiPrincipal, ApiCredentialConfig, ApiScope } from "./server/auth.js";
export { openApiDocument, serializeOpenApiDocument, checkOpenApiDocument } from "./api/index.js";
export { createApp } from "./server/app.js";
export { buildServer } from "./mcp/index.js";
