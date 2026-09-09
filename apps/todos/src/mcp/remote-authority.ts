/**
 * MCP-side authority guard.
 *
 * Plan and task-list tools are served only by the authenticated shared API
 * (the same posture the CLI enforces for `todos plans` / `todos task-lists`).
 * In local mode — or on a station with no credential — the old guard threw a
 * plain `Error`, which the MCP error formatter sanitizes to `UNKNOWN_ERROR`
 * ("An unexpected error occurred. Check server logs for details."). That made a
 * configuration requirement look like a server bug and dropped the actionable
 * diagnostic to stderr.
 *
 * `RemoteApiConfigMissingError` carries the CLI's stable `REMOTE_API_*` code
 * and a suggestion, so the formatter can return a typed, actionable payload.
 */
import { getTodosCloudClient } from "../cli/cloud-router.js";

export const REMOTE_API_CONFIG_MISSING = "REMOTE_API_CONFIG_MISSING";

export type RemoteAuthorityToolKind = "Plan" | "Task-list";

export class RemoteApiConfigMissingError extends Error {
  static readonly code = REMOTE_API_CONFIG_MISSING;
  static readonly suggestion =
    "Configure the shared Todos API: set HASNA_TODOS_API_URL and HASNA_TODOS_API_KEY, " +
    "or save account credentials, then run 'todos storage status' to confirm the resolved authority.";

  readonly code: string;
  readonly suggestion: string;
  readonly toolKind: RemoteAuthorityToolKind;

  constructor(toolKind: RemoteAuthorityToolKind, code: string = REMOTE_API_CONFIG_MISSING, detail?: string) {
    super(
      `${code}: ${toolKind} tools require the authenticated Todos API. ` +
        (detail ?? "No Todos credential resolved.") +
        " " +
        RemoteApiConfigMissingError.suggestion,
    );
    this.name = "RemoteApiConfigMissingError";
    this.code = code;
    this.suggestion = RemoteApiConfigMissingError.suggestion;
    this.toolKind = toolKind;
  }
}

/**
 * Resolve the shared API client or fail with a typed, actionable error.
 *
 * `getTodosCloudClient()` returns `null` under the deliberate local opt-in and
 * throws the CLI's `REMOTE_API_*` diagnostics for every other resolution
 * failure. Both are surfaced here as one typed error so MCP clients get the
 * same code the CLI prints instead of a sanitized `UNKNOWN_ERROR`.
 */
export function requireTodosCloudClient(
  toolKind: RemoteAuthorityToolKind,
): NonNullable<ReturnType<typeof getTodosCloudClient>> {
  let client: ReturnType<typeof getTodosCloudClient>;
  try {
    client = getTodosCloudClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = /^(REMOTE_API_[A-Z_]+):/.exec(message)?.[1];
    if (code) {
      // Preserve the resolver's own diagnostic (it names every tier consulted)
      // behind the typed code the formatter maps.
      throw new RemoteApiConfigMissingError(toolKind, code, message.slice(code.length + 2).trim());
    }
    throw error;
  }
  if (!client) {
    throw new RemoteApiConfigMissingError(
      toolKind,
      REMOTE_API_CONFIG_MISSING,
      "The local opt-in (HASNA_TODOS_LOCAL/TODOS_LOCAL) selects local SQLite for the CLI, " +
        "but these tools are served only by the shared API. Unset it and configure a credential.",
    );
  }
  return client;
}
