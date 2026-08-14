// Barrel for the domain service layer. CLI, MCP and /v1 all call through here —
// domain logic is never duplicated per surface.

export * as memberService from "./members.js";
export * as capabilityService from "./capabilities.js";
export * as lifecycleService from "./lifecycle.js";
export * as assignmentService from "./assignments.js";
export * as exportService from "./exports.js";

export * from "./authorization.js";
export * from "./registry.js";
