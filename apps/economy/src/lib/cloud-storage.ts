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

import { resolveStorageClient, type HasnaStorageClient } from "./contracts-client/storage.js";

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

/** Active cloud storage (narrowed so `client` is non-null). */
export type ActiveEconomyCloudStorage = Extract<EconomyCloudStorage, { active: true }>;

/** Query params accepted by the read helpers below. */
export type CloudQuery = Record<string, string | number | boolean | null | undefined>;

/** Drop undefined/null entries so we never send empty query params. */
function cleanQuery(query?: CloudQuery): CloudQuery | undefined {
  if (!query) return undefined;
  const out: CloudQuery = {};
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Read a collection resource from the cloud API and return the extracted array
 * (the serve envelope's `data`/`items`). Used by the read commands (sessions,
 * top, breakdown, accounts) so they render cloud data — never the local store —
 * when the client is in self_hosted/cloud mode.
 */
export async function cloudListItems<T = unknown>(
  storage: ActiveEconomyCloudStorage,
  resource: string,
  query?: CloudQuery,
): Promise<T[]> {
  const cleaned = cleanQuery(query);
  const res = await storage.client.list<T>(resource, cleaned ? { query: cleaned } : {});
  return res.items;
}

/**
 * Read a single (non-collection) resource and return the unwrapped `data`
 * payload (e.g. `/usage` -> `{ snapshots, summary }`). Falls back to the raw
 * body if the server does not use the `{ data }` envelope.
 */
export async function cloudObject<T = unknown>(
  storage: ActiveEconomyCloudStorage,
  path: string,
  query?: CloudQuery,
): Promise<T> {
  const cleaned = cleanQuery(query);
  const raw = await storage.client.transport.get<unknown>(path, cleaned ? { query: cleaned } : {});
  if (raw && typeof raw === "object" && "data" in (raw as Record<string, unknown>)) {
    return (raw as { data: T }).data;
  }
  return raw as T;
}
