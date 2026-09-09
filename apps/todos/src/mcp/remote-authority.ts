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

/**
 * The remedy for each stable `REMOTE_API_*` code.
 *
 * The code prefix alone does not imply one remedy: a missing credential and a
 * credential the authority REJECTED are different failures with different
 * fixes. Before this map every `REMOTE_API_*` refusal was answered with the
 * "configure the shared Todos API" advice, which is wrong for a 401 (the
 * credential is present and rejected — re-save it, do not re-configure the
 * URL), for a bad URL, and for a slow or unreachable authority. A client that
 * follows the wrong remedy keeps failing.
 */
export const REMOTE_API_SUGGESTIONS: Record<string, string> = {
  REMOTE_API_CONFIG_MISSING:
    "Configure the shared Todos API: set HASNA_TODOS_API_URL and HASNA_TODOS_API_KEY, " +
    "or save account credentials, then run 'todos storage status' to confirm the resolved authority.",
  REMOTE_API_KEY_MISSING:
    "Configure the shared Todos API: set HASNA_TODOS_API_URL and HASNA_TODOS_API_KEY, " +
    "or save account credentials, then run 'todos storage status' to confirm the resolved authority.",
  REMOTE_API_CREDENTIAL_INVALID:
    "The stored Todos credential could not be read as a valid key. Re-save it (Keychain or " +
    "HASNA_TODOS_API_KEY) and run 'todos storage status' to confirm the resolved authority.",
  REMOTE_API_URL_INVALID:
    "Fix HASNA_TODOS_API_URL to the base URL of the shared Todos API, then run " +
    "'todos storage status' to confirm the resolved authority.",
  REMOTE_API_UNAUTHORIZED:
    "The configured credential was REJECTED by the authority — it is present, so re-configuring " +
    "it is not the fix. Re-save it (or issue a new key) and run 'todos storage status' to confirm " +
    "the resolved authority.",
  REMOTE_API_FORBIDDEN:
    "The configured credential is not permitted on this route. Check its role/scopes for the " +
    "project, then retry.",
  REMOTE_API_REDIRECT_REJECTED:
    "The authority redirected the request and redirects are not followed. Point " +
    "HASNA_TODOS_API_URL at the final API base URL.",
  REMOTE_API_TIMEOUT:
    "The shared Todos API did not answer in time. Retry, and check connectivity to the resolved authority.",
  REMOTE_API_UNREACHABLE:
    "The shared Todos API could not be reached. Check connectivity and the resolved authority URL, then retry.",
  REMOTE_API_UNAVAILABLE:
    "The shared Todos API returned a server error. Retry shortly; if it persists, check " +
    "'todos storage status'.",
  REMOTE_API_INCOMPATIBLE:
    "The resolved authority does not serve this route in a compatible shape. Check that " +
    "HASNA_TODOS_API_URL points at a Todos API this client version supports.",
};

/** Remedy for one `REMOTE_API_*` code; unknown codes get the configuration remedy. */
export function suggestionForRemoteApiCode(code: string): string {
  return REMOTE_API_SUGGESTIONS[code] ?? RemoteApiConfigMissingError.suggestion;
}

export class RemoteApiConfigMissingError extends Error {
  static readonly code = REMOTE_API_CONFIG_MISSING;
  static readonly suggestion = REMOTE_API_SUGGESTIONS[REMOTE_API_CONFIG_MISSING]!;

  readonly code: string;
  readonly suggestion: string;
  readonly toolKind: RemoteAuthorityToolKind;

  constructor(toolKind: RemoteAuthorityToolKind, code: string = REMOTE_API_CONFIG_MISSING, detail?: string) {
    const suggestion = suggestionForRemoteApiCode(code);
    super(
      `${code}: ${toolKind} tools require the authenticated Todos API. ` +
        (detail ?? "No Todos credential resolved.") +
        " " +
        suggestion,
    );
    this.name = "RemoteApiConfigMissingError";
    this.code = code;
    this.suggestion = suggestion;
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
