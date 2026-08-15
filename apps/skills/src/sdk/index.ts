/**
 * @hasna/skills/sdk — the import surface for embedding the skills service.
 *
 * Server/router, registry + version service, run protocol + atomic run services,
 * dispatcher adapters, executor, and storage/object-store seams. Every module
 * re-exports the shipped implementation with the interface as the contract; nothing
 * here duplicates business logic. The SaaS control plane imports this package directly
 * and never spawns the server binaries.
 */
export * from "./server.js";
export * from "./registry.js";
export * from "./runs.js";
export * from "./dispatcher.js";
export * from "./executor.js";
export * from "./storage.js";
export * from "./execution/index.js";
