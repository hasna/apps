/**
 * Integration resolver registry.
 *
 * Maps each integration kind to its owning-package resolver. Resolvers accept
 * injectable read surfaces so tests can exercise projections, redaction,
 * fail-closed codes, and side-effect discipline without touching live apps.
 */

import type { IntegrationKind, ParsedIntegrationRef, ResolvedIntegration } from "./types.js"
import { IntegrationResolutionError } from "./types.js"
import { parseIntegrationRef } from "./parse.js"
import { resolveTodo, type TodoReadSurface } from "./resolvers/todo.js"
import { resolveChannel, type ChannelReadSurface } from "./resolvers/channel.js"
import { resolveKnowledge, type KnowledgeReadSurface } from "./resolvers/knowledge.js"
import { resolveMemento, type MementoReadSurface } from "./resolvers/memento.js"
import { resolveFile, type FileReadSurface } from "./resolvers/file.js"

/** Injectable read surfaces per owning app. Tests pass fakes; defaults hit the
 * owning packages' SDKs. */
export interface IntegrationDeps {
  todo?: TodoReadSurface
  channel?: ChannelReadSurface
  knowledge?: KnowledgeReadSurface
  memento?: MementoReadSurface
  file?: FileReadSurface
}

export type ResolverSurfaceMap = {
  todo: TodoReadSurface | undefined
  channel: ChannelReadSurface | undefined
  knowledge: KnowledgeReadSurface | undefined
  memento: MementoReadSurface | undefined
  file: FileReadSurface | undefined
}

/**
 * Resolve one parsed integration ref through its owning package's resolver.
 * Throws IntegrationResolutionError with a named code on any failure.
 */
export async function resolveIntegrationRef(
  ref: ParsedIntegrationRef,
  deps: ResolverSurfaceMap,
): Promise<ResolvedIntegration> {
  switch (ref.kind) {
    case "todo":
      return resolveTodo(ref, deps.todo)
    case "channel":
      return resolveChannel(ref, deps.channel)
    case "knowledge":
      return resolveKnowledge(ref, deps.knowledge)
    case "memento":
      return resolveMemento(ref, deps.memento)
    case "file":
      return resolveFile(ref, deps.file)
  }
}

/**
 * Parse one raw integration ref (kind + payload) into its typed form.
 * Throws the app's INVALID code when the payload is malformed.
 */
export function parseRefOrThrow(raw: string, kind: IntegrationKind, payload: string): ParsedIntegrationRef {
  const parsed = parseIntegrationRef(kind, raw, payload)
  if (!parsed) {
    const code = integrationInvalidCode(kind)
    throw new IntegrationResolutionError(code, kind, raw, `invalid ${kind} reference: ${payload}`)
  }
  return parsed
}

export function integrationInvalidCode(kind: IntegrationKind): IntegrationResolutionError["code"] {
  switch (kind) {
    case "todo":
      return "TODO_INVALID"
    case "channel":
      return "CHANNEL_INVALID"
    case "knowledge":
      return "KNOWLEDGE_RESPONSE_INVALID"
    case "memento":
      return "MEMENTO_INVALID"
    case "file":
      return "FILE_UNSUPPORTED"
  }
}

/** Build a resolver surface map from optional injectable deps. */
export function buildSurfaceMap(deps: IntegrationDeps = {}): ResolverSurfaceMap {
  return {
    todo: deps.todo,
    channel: deps.channel,
    knowledge: deps.knowledge,
    memento: deps.memento,
    file: deps.file,
  }
}
