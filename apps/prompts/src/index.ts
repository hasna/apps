// DB layer
export { createPrompt, getPrompt, listPromptsSlim, promptToSaveResult, requirePrompt, listPrompts, updatePrompt, deletePrompt, usePrompt, upsertPrompt, getPromptStats, pinPrompt, setNextPrompt } from "./db/prompts.js"
export { listVersions, getVersion, restoreVersion } from "./db/versions.js"
export { listCollections, getCollection, ensureCollection, movePrompt } from "./db/collections.js"
export { registerAgent, listAgents } from "./db/agents.js"
export { getDatabase, getDbPath } from "./db/database.js"
export { createProject, getProject, listProjects, deleteProject } from "./db/projects.js"

// Search
export { searchPrompts, searchPromptsSlim, findSimilar } from "./lib/search.js"

// Templates
export { extractVariables, extractVariableInfo, renderTemplate, validateVars } from "./lib/template.js"
export type { VariableInfo } from "./lib/template.js"

// Import/Export
export { importFromJson, exportToJson } from "./lib/importer.js"
export { findDuplicates } from "./lib/duplicates.js"
export type { DuplicateMatch } from "./lib/duplicates.js"

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
