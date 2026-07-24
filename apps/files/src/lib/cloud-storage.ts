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
  const resolved = resolveStorageClient(FILES_APP, env, overrides);
  return resolved.transport === "cloud-http"
    ? { active: true, client: resolved.client }
    : { active: false, client: null };
}
