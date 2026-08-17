/**
 * Cross-app integration resolution for the prompts render engine.
 *
 * Each owning package exposes a public SDK/root read surface. Prompts never
 * opens another app's database; resolution goes through the owning package's
 * own exported functions, which route local-or-API internally.
 *
 * Every injection is a FIXED, VERSIONED projection. Default render behavior is
 * fail-closed with a named code; an explicit permissive preview may emit
 * `[UNRESOLVED kind:ref code=...]`, never an empty string.
 */

export type IntegrationKind = "todo" | "channel" | "knowledge" | "memento" | "file"

/**
 * Named failure codes per owning app (report D table).
 *
 * The `<APP>_UNAVAILABLE` codes are documented extensions of the D table,
 * covering "the owning package is not installed / cannot be imported" — a
 * state the D table does not enumerate but a fail-closed resolver must name
 * (knowledge's table already sanctions KNOWLEDGE_UNAVAILABLE).
 */
export type IntegrationErrorCode =
  // todos
  | "TODO_INVALID"
  | "TODO_NOT_FOUND"
  | "TODO_AMBIGUOUS"
  | "TODO_AUTH_FAILED"
  | "TODO_TIMEOUT"
  | "TODO_RESPONSE_INVALID"
  | "TODO_UNAVAILABLE"
  // conversations
  | "CHANNEL_INVALID"
  | "CHANNEL_NOT_FOUND"
  | "CHANNEL_AUTH_FAILED"
  | "CHANNEL_TIMEOUT"
  | "CHANNEL_RESPONSE_INVALID"
  | "CHANNEL_UNAVAILABLE"
  // knowledge
  | "KNOWLEDGE_NOT_FOUND"
  | "KNOWLEDGE_UNAVAILABLE"
  | "KNOWLEDGE_TOO_LARGE"
  | "KNOWLEDGE_RESPONSE_INVALID"
  // mementos
  | "MEMENTO_INVALID"
  | "MEMENTO_NOT_FOUND"
  | "MEMENTO_AMBIGUOUS"
  | "MEMENTO_AUTH_FAILED"
  | "MEMENTO_TIMEOUT"
  | "MEMENTO_RESPONSE_INVALID"
  | "MEMENTO_UNAVAILABLE"
  // files
  | "FILE_NOT_FOUND"
  | "FILE_DENIED"
  | "FILE_UNSUPPORTED"
  | "FILE_TOO_LARGE"
  | "FILE_ERROR"
  | "FILE_UNAVAILABLE"

/** Map "owning package not importable" to the app's availability code. */
export function unavailableCodeFor(kind: IntegrationKind): IntegrationErrorCode {
  switch (kind) {
    case "todo":
      return "TODO_UNAVAILABLE"
    case "channel":
      return "CHANNEL_UNAVAILABLE"
    case "knowledge":
      return "KNOWLEDGE_UNAVAILABLE"
    case "memento":
      return "MEMENTO_UNAVAILABLE"
    case "file":
      return "FILE_UNAVAILABLE"
  }
}

/** An integration reference as written in a prompt body. */
export interface IntegrationRef {
  kind: IntegrationKind
  /** The full `{{kind:...}}` placeholder text. */
  raw: string
  /** The payload after `kind:` — e.g. a full UUID, channel id, or URI. */
  payload: string
}

/** Parsed per-kind reference payloads. */
export type ParsedIntegrationRef =
  | { kind: "todo"; raw: string; id: string }
  | { kind: "channel"; raw: string; channelId: string }
  | { kind: "knowledge"; raw: string; id: string }
  | { kind: "memento"; raw: string; mode: "id" | "key" | "search"; value: string }
  | { kind: "file"; raw: string; uri: string }

/** Resolved integration with its fixed, versioned projection. */
export interface ResolvedIntegration {
  kind: IntegrationKind
  ref: string
  /** Owning app's stable source identifier (task id, channel id, ...). */
  source_id: string
  /** Owning app's version when the projection carries one. */
  source_version?: string | number | null
  /** Projection schema marker, e.g. `todo.v1`. */
  projection: string
  /** Serialized projection text injected into the rendered body. */
  text: string
}

/** Unresolved integration — named code, never an empty string in permissive mode. */
export interface UnresolvedIntegration {
  kind: IntegrationKind
  ref: string
  code: IntegrationErrorCode
  message: string
}

/** Shared envelope for a resolved projection's serialized text. */
export function wrapProjectionText(
  kind: IntegrationKind,
  ref: string,
  projection: string,
  body: string,
): string {
  const marker = `[INTEGRATION ${kind}:${ref} projection=${projection}]`
  return `${marker}${body}[/INTEGRATION]`
}

/** Error thrown when default (fail-closed) render meets an unresolved integration. */
export class IntegrationResolutionError extends Error {
  readonly code: IntegrationErrorCode
  readonly kind: IntegrationKind
  readonly ref: string

  constructor(code: IntegrationErrorCode, kind: IntegrationKind, ref: string, message: string) {
    super(message)
    this.name = "IntegrationResolutionError"
    this.code = code
    this.kind = kind
    this.ref = ref
  }
}

/** Render-receipt entry for one resolved integration ref. */
export interface ResolvedIntegrationReceipt {
  kind: IntegrationKind
  ref: string
  source_id: string
  source_version: string | number | null
  projection: string
}

/** Render-receipt entry for one unresolved integration ref. */
export interface UnresolvedIntegrationReceipt {
  kind: IntegrationKind
  ref: string
  code: IntegrationErrorCode
}
