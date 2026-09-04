// Client-side hosted-storage resolver for @hasna/files.
//
// The client has exactly two transports, selected by the environment contract:
//
//   - hosted: `HASNA_FILES_API_URL` AND `HASNA_FILES_API_KEY` are both set. The
//     CLI routes its reads and writes to the files service at `<API_URL>/v1`
//     with the bearer key — NOT to the local SQLite store, and NEVER to a raw
//     database DSN.
//   - local: neither is set. Reads and writes use the on-box SQLite store at
//     the files data root's files.db.
//
// A half-configured pair (URL without key, or key without URL) is a
// misconfiguration and throws (fail-closed): the client never silently falls
// back to a different dataset.
//
// This module is the single seam the CLI consults. It returns a ready
// `HasnaStorageClient` (from @hasna/contracts) when the hosted transport is
// active, or `{ active: false }` so the caller falls back to the local store.
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

/** True when any of `keys` carries a non-blank value. The value is never read out. */
function anySet(source: NodeJS.ProcessEnv, keys: readonly string[]): boolean {
  return keys.some((k) => (source[k]?.trim() ?? "") !== "");
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
 * Hosted when HASNA_FILES_API_URL + HASNA_FILES_API_KEY are both set;
 * otherwise local. Throws on a half-configured pair, and throws if the storage
 * client resolves away from the hosted transport we decided on — a client
 * never silently reads a different dataset.
 */
export function resolveFilesCloudStorage(
  env: NodeJS.ProcessEnv = process.env,
  overrides?: StorageClientOverrides,
): FilesCloudStorage {
  const urlPresent = anySet(env, API_URL_KEYS);
  const keyPresent = anySet(env, API_KEY_KEYS);
  if (!urlPresent && !keyPresent) {
    return { active: false, client: null, fetchContent: null };
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
