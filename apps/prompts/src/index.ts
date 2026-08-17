// DB layer
export { createPrompt, getPrompt, listPromptsSlim, promptToSaveResult, requirePrompt, listPrompts, updatePrompt, deletePrompt, usePrompt, upsertPrompt, getPromptStats, pinPrompt, setNextPrompt, feedContentlessFts } from "./db/prompts.js"
export { listVersions, getVersion, restoreVersion } from "./db/versions.js"
export { listCollections, getCollection, ensureCollection, movePrompt } from "./db/collections.js"
export { registerAgent, listAgents } from "./db/agents.js"
export { getDatabase, getDbPath, resolveServerBackend, hasContentlessFts } from "./db/database.js"
export type { DbPathOptions } from "./db/database.js"
export { createProject, getProject, listProjects, deleteProject } from "./db/projects.js"

// Client transport: the canonical SQLite-or-HTTP selection.
export {
  resolvePromptsClientTransport,
  assertNoRetiredPromptsStorageSelector,
  RetiredPromptsStorageSelectorError,
  PROMPTS_API_URL_ENV,
  PROMPTS_API_KEY_ENV,
  PROMPTS_DATABASE_URL_ENV,
  RETIRED_PROMPTS_SELECTOR_ENV_KEYS,
  RETIRED_PROMPTS_REGISTRY_ENV_KEYS,
} from "./client-transport.js"
export type { PromptsClientTransport, PromptsClientTransportReport } from "./client-transport.js"

// Body store: immutable markdown objects, local folder or S3.
export {
  LocalBodyStore,
  S3BodyStore,
  resolveBodyStore,
  normalizeBodyKey,
  promptBodyKey,
  sha256Hex,
  bytesOf,
  readBodyVerified,
  PromptBodyCorruptError,
  PromptBodyMissingError,
  PROMPTS_BODY_PATH_ENV,
  PROMPTS_S3_BUCKET_ENV,
  PROMPTS_S3_PREFIX_ENV,
  PROMPTS_AWS_REGION_ENV,
} from "./body-store.js"
export type { BodyStore, BodyWrite, BodyWriteResult, S3BodyStoreOptions, VerifiedBodyRead } from "./body-store.js"

// Storage verbs: status, migration, reconciliation.
export { storageStatus } from "./storage/status.js"
export type { StorageStatusReport } from "./storage/status.js"
export {
  buildMigrationInventory,
  migrationDryRun,
  migrationApply,
  reconcileBodies,
  inventoryHash,
  migrationReceiptPath,
} from "./storage/migrate.js"
export type {
  MigrationInventory,
  MigrationDryRunReport,
  MigrationApplyReport,
  ReconcileReport,
  MigrationItem,
} from "./storage/migrate.js"
export { writePromptBodyObject, registerBodyObject, readPromptBodyVerified, getBodyStore, getResolvedBodyStore, resetBodyStore } from "./storage/bodies.js"
export type { BodyWriteRecord, VerifiedReadResult } from "./storage/bodies.js"

// HTTP store: hosted client surface selected by HASNA_PROMPTS_API_URL.
export { createPromptsHttpStore, resolvePromptsHttpStore, PROMPTS_RESOURCE } from "./http-store.js"
export type { PromptsHttpStore, PromptsHttpListOptions, PromptsHttpSearchOptions, PromptsHttpCreateInput, PromptsHttpPatch } from "./http-store.js"

// Search
export { searchPrompts, searchPromptsSlim, findSimilar } from "./lib/search.js"

// Templates
export { extractVariables, extractVariableInfo, renderTemplate, validateVars } from "./lib/template.js"
export type { VariableInfo } from "./lib/template.js"

// Import/Export
export { importFromJson, exportToJson } from "./lib/importer.js"
export { findDuplicates } from "./lib/duplicates.js"
export type { DuplicateMatch } from "./lib/duplicates.js"

// Runbook lint
export { analyzeRunbookPrompts, parseRunbookDetections, RUNBOOK_DETECTION_KINDS } from "./lib/runbook-lint.js"
export type {
  RunbookDetectionKind,
  RunbookFindingFile,
  RunbookLineSpan,
  RunbookLintFinding,
  RunbookLintReport,
  RunbookPromptFile,
} from "./lib/runbook-lint.js"

// IDs
export { generateSlug, uniqueSlug, generatePromptId } from "./lib/ids.js"

// Types
export type {
  Prompt,
  SlimPrompt,
  SaveResult,
  SlimSearchResult,
  PromptVersion,
  Collection,
  Agent,
  Project,
  TemplateVariable,
  PromptSource,
  CreatePromptInput,
  UpdatePromptInput,
  ListPromptsFilter,
  SearchResult,
  RenderResult,
  PromptStats,
} from "./types/index.js"

export {
  PromptNotFoundError,
  VersionConflictError,
  DuplicateSlugError,
  TemplateRenderError,
  ProjectNotFoundError,
} from "./types/index.js"
