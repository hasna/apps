// Client-side self_hosted storage resolver for @hasna/files.
//
// When the client-flip contract resolves to `cloud-http` (mode=self_hosted/cloud
// AND HASNA_FILES_API_URL + HASNA_FILES_API_KEY are set), the CLI must route its
// reads and writes to the app's cloud API at `https://files.md/v1` with the
// bearer key — NOT to the local SQLite store, and NEVER to a raw database DSN.
//
// This module is the single seam the CLI consults. It returns a ready
// `HasnaStorageClient` (from @hasna/contracts) when cloud is active, or
// `{ active: false }` so the caller falls back to the local store. It throws (via
// resolveStorageClient) when cloud is requested but misconfigured, so a client can
// never silently drift back to the wrong dataset.
//
// SAFETY: never logs or embeds the API key — it lives only inside the transport.

import { resolveStorageClient, type HasnaStorageClient } from "@hasna/contracts/client/storage";

/** Transport overrides (test injection: fetchImpl, headers, timeout, retry). */
type StorageClientOverrides = Parameters<typeof resolveStorageClient>[2];

/** The files app slug used for the HASNA_<APP>_* env lookups. */
export const FILES_APP = "files";

// -- Explicit mode selection -------------------------------------------------
//
// This client PINS the storage mode before calling the contracts resolver. It
// must never depend on that resolver inferring a cloud transition from the mere
// presence of an API URL (or of a credential the resolver can find on disk).
//
// Owner ruling 2026-07-29: a local->network transition must be explicitly
// signalled, never inferred from a credential file appearing on disk. The
// contracts client still infers today, and hasna/contracts#51 removes it. When
// that lands, a consumer that passes `process.env` straight through gets the
// LOCAL SQLite store for a fully-configured cloud client -- silently, at exit 0,
// which is the exact silent-degrade this fleet has spent the day chasing.
//
// Measured 2026-07-30: of the five repos importing the contracts client at
// runtime, `domains`, `logs` and `todos` already pin; `files` and `sessions` did
// not, and were the two that #51 would strand. This is the `files` pin, and it
// deliberately mirrors `withImpliedSelfHostedMode` in @hasna/logs so the fleet
// converges on one shape rather than five.
//
// Pinning is also what makes this client immune to WHICH inference is live
// upstream -- env pair, URL alone, or disk credential. The mode is ours to state.

const MODE_KEYS = [
  "HASNA_FILES_STORAGE_MODE",
  "HASNA_FILES_MODE",
  "FILES_STORAGE_MODE",
  "FILES_MODE",
] as const;
const API_URL_KEYS = ["HASNA_FILES_API_URL", "FILES_API_URL"] as const;
const API_KEY_KEYS = ["HASNA_FILES_API_KEY", "FILES_API_KEY"] as const;

/** True when any of `keys` carries a non-blank value. The value is never read out. */
function anySet(source: NodeJS.ProcessEnv, keys: readonly string[]): boolean {
  return keys.some((k) => (source[k]?.trim() ?? "") !== "");
}

/**
 * Return an env whose storage mode is explicit.
 *
 * An already-set mode -- through any of the four documented variables -- is left
 * exactly as it is, so an operator pinning `local` is never overridden. Only the
 * complete API url + key pair implies `self_hosted`; half a pair implies nothing,
 * because half a pair is not a statement of intent.
 */
export function filesCloudEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (anySet(source, MODE_KEYS)) return source;
  if (anySet(source, API_URL_KEYS) && anySet(source, API_KEY_KEYS)) {
    return { ...source, HASNA_FILES_STORAGE_MODE: "self_hosted" };
  }
  return source;
}

export type FilesCloudStorage =
  | {
      /** True when reads/writes must go to the cloud HTTP API. */
      readonly active: true;
      /** The ready HTTP storage client. */
      readonly client: HasnaStorageClient;
    }
  | {
      readonly active: false;
      readonly client: null;
    };

/**
 * Resolve the files client storage transport for the current environment.
 *
 * Returns `{ active: true, client }` only when mode=self_hosted/cloud AND
 * HASNA_FILES_API_URL + HASNA_FILES_API_KEY are set. Otherwise `{ active: false }`
 * (local store). Throws if cloud was requested but is misconfigured.
 *
 * Callers do not use this directly — {@link resolveStore} consults it and picks
 * the {@link ApiStore} or {@link LocalStore} transport. It is the one place the
 * client decides local vs cloud.
 */
export function resolveFilesCloudStorage(
  env: NodeJS.ProcessEnv = process.env,
  overrides?: StorageClientOverrides,
): FilesCloudStorage {
  const resolved = resolveStorageClient(FILES_APP, filesCloudEnv(env), overrides);
  return resolved.transport === "cloud-http"
    ? { active: true, client: resolved.client }
    : { active: false, client: null };
}
