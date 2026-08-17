/**
 * Cross-app integration resolution for the prompts render engine.
 *
 * Public surface: `renderTemplateWithIntegrations` for the render path, the
 * typed parsers and resolvers for tooling (MCP `prompts_resolve`), and the
 * named error types.
 */

export { renderTemplateWithIntegrations, type IntegrationRenderOptions, type IntegrationRenderResult } from "./render.js"
export { hasIntegrationRefs, extractIntegrationRefs, parseIntegrationRef, parseIntegrationRefs, isFullUuid } from "./parse.js"
export { resolveIntegrationRef, parseRefOrThrow, integrationInvalidCode, buildSurfaceMap, type IntegrationDeps, type ResolverSurfaceMap } from "./registry.js"
export { IntegrationResolutionError, wrapProjectionText } from "./types.js"
export type {
  IntegrationKind,
  IntegrationErrorCode,
  IntegrationRef,
  ParsedIntegrationRef,
  ResolvedIntegration,
  UnresolvedIntegration,
  ResolvedIntegrationReceipt,
  UnresolvedIntegrationReceipt,
} from "./types.js"
export { TODO_PROJECTION, TODO_PROJECTION_FIELDS, projectTodoRecord, serializeTodoProjection, type TodoReadSurface, type TodoProjectionData } from "./resolvers/todo.js"
export { CHANNEL_PROJECTION, projectChannel, serializeChannelProjection, type ChannelReadSurface, type ChannelProjectionData } from "./resolvers/channel.js"
export { KNOWLEDGE_PROJECTION, projectKnowledgeItem, serializeKnowledgeProjection, type KnowledgeReadSurface, type KnowledgeProjectionData } from "./resolvers/knowledge.js"
export { MEMENTO_PROJECTION, MEMENTO_SEARCH_PROJECTION, projectMemento, serializeMementoProjection, serializeMementoSearchProjection, type MementoReadSurface, type MementoProjectionData, type MementoSearchProjectionData } from "./resolvers/memento.js"
export { FILE_PROJECTION, projectFilePack, serializeFileProjection, type FileReadSurface, type FileProjectionData } from "./resolvers/file.js"
export { redactText, containsCredentialShape, truncateText, PROJECTION_BOUNDS } from "./redact.js"
