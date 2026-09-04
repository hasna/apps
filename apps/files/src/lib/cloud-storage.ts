// Client-side hosted-storage resolver for @hasna/files.
//
// The client has exactly two transports, selected by the environment contract:
//
//   - hosted: `HASNA_FILES_API_URL` AND `HASNA_FILES_API_KEY` are both set (the
//     unprefixed `FILES_API_URL` / `FILES_API_KEY` aliases are also accepted).
//     The CLI routes its reads and writes to the files service at `<API_URL>/v1`
//     with the bearer key — NOT to the local SQLite store, and NEVER to a raw
//     database DSN.
//   - local (explicit opt-in only): the on-box SQLite store at
//     `~/.hasna/files/files.db`, reachable ONLY when the operator sets the
//     documented opt-in `HASNA_FILES_LOCAL_MODE=1` (alias `FILES_LOCAL_MODE=1`).
//
// When neither hosted env var is set and no local opt-in is present, resolution
// throws (fail-closed): a fleet CLI must never silently fall back to the local
// store — no `~/.hasna/files/files.db` on first use, no false-green local
// session. Local mode is never a default.
//
// A half-configured pair (URL without key, or key without URL) is a
// misconfiguration and throws (fail-closed): the client never silently falls
// back to a different dataset.
//
// This module is the single seam the CLI consults. It returns a ready
// `HasnaStorageClient` (from @hasna/contracts) when the hosted transport is
// active, or `{ active: false }` so the caller uses the local store the
// operator explicitly opted into.
//
// SAFETY: never logs or embeds the API key — it lives only inside the transport.

import { resolveStorageClient, type HasnaStorageClient } from "@hasna/contracts/client/storage";

/** Transport overrides (test injection: fetchImpl, headers, timeout, retry). */
type StorageClientOverrides = Parameters<typeof resolveStorageClient>[2];
export type AuthenticatedFilesFetch = (path: string, init?: RequestInit) => Promise<Response>;

/** The files app slug used for the HASNA_<APP>_* env lookups. */
export const FILES_APP = "files";

const API_URL_KEYS = ["HASNA_FILES_API_URL", "FILES_API_URL"] as const;
const API_KEY_KEYS = ["HASNA_FILES_API_KEY", "FILES_API_KEY"] as const;
/** The documented explicit opt-in for the on-box SQLite store (never a default). */
const LOCAL_MODE_KEYS = ["HASNA_FILES_LOCAL_MODE", "FILES_LOCAL_MODE"] as const;

/** True when any of `keys` carries a non-blank value. The value is never read out. */
function anySet(source: NodeJS.ProcessEnv, keys: readonly string[]): boolean {
  return keys.some((k) => (source[k]?.trim() ?? "") !== "");
}

/** True when the operator explicitly opted in to local mode (a truthy value). */
export function localModeOptedIn(source: NodeJS.ProcessEnv): boolean {
  for (const key of LOCAL_MODE_KEYS) {
    const value = source[key]?.trim().toLowerCase();
    if (value && value !== "0" && value !== "false" && value !== "no") return true;
  }
  return false;
}

function firstSet(source: NodeJS.ProcessEnv, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = source[key]?.trim();
    if (value) return value;
  }
  return null;
}

export type FilesCloudStorage =
  | {
      /** True when reads/writes must go to the hosted HTTP API. */
      readonly active: true;
      /** The ready HTTP storage client. */
      readonly client: HasnaStorageClient;
      /**
       * Authenticated raw-response fetch for private file bytes. The key stays
       * captured inside this function and is never returned or logged.
       */
      readonly fetchContent: AuthenticatedFilesFetch;
    }
  | {
      readonly active: false;
      readonly client: null;
      readonly fetchContent: null;
    };

/**
 * Resolve the files client storage transport for the current environment.
 *
 * Hosted when HASNA_FILES_API_URL + HASNA_FILES_API_KEY are both set. Local
 * (on-box SQLite) ONLY when the explicit opt-in HASNA_FILES_LOCAL_MODE (alias
 * FILES_LOCAL_MODE) is set and no hosted pair is present. When neither hosted
 * pair nor local opt-in is present this throws with an actionable error that
 * names the required env — the client never silently opens the local store.
 * Throws on a half-configured pair, and throws if the storage client resolves
 * away from the hosted transport we decided on — a client never silently reads
 * a different dataset.
 */
export function resolveFilesCloudStorage(
  env: NodeJS.ProcessEnv = process.env,
  overrides?: StorageClientOverrides,
): FilesCloudStorage {
  const urlPresent = anySet(env, API_URL_KEYS);
  const keyPresent = anySet(env, API_KEY_KEYS);
  if (!urlPresent && !keyPresent) {
    if (localModeOptedIn(env)) {
      return { active: false, client: null, fetchContent: null };
    }
    throw new Error(
      `Files is not configured for the hosted API: set ${API_URL_KEYS[0]} and ` +
        `${API_KEY_KEYS[0]} together (aliases ${API_URL_KEYS[1]} / ${API_KEY_KEYS[1]}) to use ` +
        `the hosted files service, or set ${LOCAL_MODE_KEYS[0]}=1 (alias ${LOCAL_MODE_KEYS[1]}=1) ` +
        `to explicitly opt in to the on-box SQLite store. The files CLI never silently falls back ` +
        `to local storage.`,
    );
  }
  if (!urlPresent || !keyPresent) {
    throw new Error(
      `Files hosted storage is partially configured: set both ${API_URL_KEYS[0]} and ` +
        `${API_KEY_KEYS[0]} together (found ${urlPresent ? "API URL" : "no API URL"}, ` +
        `${keyPresent ? "API key" : "no API key"}). The client requires the complete pair to ` +
        `use the hosted API and never falls back to the local store when either half is set.`,
    );
  }
  const resolved = resolveStorageClient(FILES_APP, env, overrides);
  if (resolved.transport !== "http") {
    throw new Error(
      "Files client decided to use the hosted API (API URL + key set) but the storage client " +
        "resolved to a different transport; refusing to silently use the wrong dataset.",
    );
  }

  const apiKey = firstSet(env, API_KEY_KEYS);
  if (!apiKey) {
    throw new Error("Files hosted storage resolved without an API key.");
  }
  const fetchImpl = overrides?.fetchImpl ?? globalThis.fetch;
  const inheritedHeaders = overrides?.headers ?? {};
  const fetchContent: AuthenticatedFilesFetch = async (path, init = {}) => {
    const headers = new Headers(inheritedHeaders);
    for (const [name, value] of new Headers(init.headers)) headers.set(name, value);
    headers.set("x-api-key", apiKey);
    headers.set("authorization", `Bearer ${apiKey}`);
    return fetchImpl(`${resolved.client.baseUrl}${path}`, { ...init, headers });
  };

  return { active: true, client: resolved.client, fetchContent };
}
