// Client-side self_hosted storage resolver for @hasna/economy.
//
// When the client-flip contract resolves to `cloud-http` (mode=self_hosted/cloud
// AND HASNA_ECONOMY_API_URL + HASNA_ECONOMY_API_KEY are set), the CLI must route
// its reads and writes to the app's cloud API at `https://economy.hasna.xyz/v1`
// with the bearer key — NOT to the local SQLite store, and NEVER to a raw
// database DSN.
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

/** The economy app slug used for the HASNA_<APP>_* env lookups. */
export const ECONOMY_APP = "economy";

export type EconomyCloudStorage =
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

let cache: EconomyCloudStorage | undefined;

/**
 * Resolve the economy client storage transport for the current environment.
 *
 * Returns `{ active: true, client }` only when mode=self_hosted/cloud AND
 * HASNA_ECONOMY_API_URL + HASNA_ECONOMY_API_KEY are set. Otherwise
 * `{ active: false }` (local store). Throws if cloud was requested but is
 * misconfigured.
 */
export function resolveEconomyCloudStorage(
  env: NodeJS.ProcessEnv = process.env,
  overrides?: StorageClientOverrides,
): EconomyCloudStorage {
  const resolved = resolveStorageClient(ECONOMY_APP, env, overrides);
  return resolved.transport === "cloud-http"
    ? { active: true, client: resolved.client }
    : { active: false, client: null };
}

/** Memoized {@link resolveEconomyCloudStorage} for the process lifetime. */
export function economyCloudStorage(env: NodeJS.ProcessEnv = process.env): EconomyCloudStorage {
  if (cache === undefined) cache = resolveEconomyCloudStorage(env);
  return cache;
}

/** Test-only: drop the memoized resolution so a new env can be resolved. */
export function resetEconomyCloudStorageCache(): void {
  cache = undefined;
}
