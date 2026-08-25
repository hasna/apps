/**
 * @hasna/workflows SDK entry — the importable module surface.
 * Re-exports the domain service, the HTTP handlers, and the MCP tool
 * registry so every surface is reachable programmatically.
 */
export { WorkflowsService, createWorkflowsService, packageVersion, resolveWorkflowsConfig } from "./service.js";
export { createRequestHandler, jsonResponse } from "./handlers.js";
export { workflowsTools, callWorkflowTool } from "./agent-tools.js";
export type { WorkflowsConfig, HealthReport, ReadinessReport } from "./types.js";
export type { McpTool, ToolCallResult } from "./agent-tools.js";
