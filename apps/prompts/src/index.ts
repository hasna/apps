// DB layer
export { createPrompt, getPrompt, listPromptsSlim, promptToSaveResult, requirePrompt, listPrompts, updatePrompt, deletePrompt, usePrompt, upsertPrompt, getPromptStats, pinPrompt, setNextPrompt } from "./db/prompts.js"
export { listVersions, getVersion, restoreVersion } from "./db/versions.js"
export { listCollections, getCollection, ensureCollection, movePrompt } from "./db/collections.js"
export { registerAgent, listAgents } from "./db/agents.js"
export { getDatabase, getDbPath, getPromptRegistryDiagnostics, resolveStorageMode } from "./db/database.js"
export type {
  DbPathOptions,
  PromptRegistryDiagnostics,
  PromptsActiveStorage,
  PromptsRegistryState,
  PromptsStorageMode,
} from "./db/database.js"
export { createProject, getProject, listProjects, deleteProject } from "./db/projects.js"

// Search
export { searchPrompts, searchPromptsSlim, findSimilar } from "./lib/search.js"

// Templates
export { extractVariables, extractVariableInfo, renderTemplate, validateVars, getPath, definitionsFromVariables } from "./lib/template.js"
export type { VariableInfo, VariableDefinition, PartialSource, RenderOptions } from "./lib/template.js"

// Typed variable metadata
export { syncPromptVariables, loadPromptVariables, loadPromptVariablesForPrompts } from "./db/variables.js"

// Labels
export { setLabel, removeLabel, listLabels, normalizeLabelKey, normalizeLabelValue } from "./db/labels.js"

// Template dependencies (parents + partials) and dependency-aware rendering
export {
  setDependency,
  setParent,
  setPartial,
  removeDependency,
  listDependencies,
  getParent,
  composeBodyWithParent,
  renderPromptTemplate,
} from "./db/dependencies.js"

// Render receipts
export { recordRenderReceipt, getRenderReceipts, renderHash } from "./db/receipts.js"

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
  VariableSchemaEntry,
  TemplateValueType,
  TemplateRenderFormat,
  PromptLabel,
  PromptDependency,
  PromptDependencyRelation,
  ResolvedSource,
  RenderReceipt,
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
