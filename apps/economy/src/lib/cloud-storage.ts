// Client-side hosted storage resolver for @hasna/economy.
//
// The client has exactly two stores: the local SQLite store and the hosted HTTP
// API. The hosted route is selected by the env contract — both
// HASNA_ECONOMY_API_URL and HASNA_ECONOMY_API_KEY set — and routes reads/writes
// to the app's hosted API at `https://economy.hasna.xyz/v1` with the bearer key,
// NOT to the local SQLite store and NEVER to a raw database DSN.
//
// This module is the single seam the CLI consults. It returns a ready
// `HasnaStorageClient` (from @hasna/contracts) when the hosted route is active,
// or `{ active: false }` so the caller falls back to the local store. It throws
// (via resolveStorageClient) when the hosted route is requested but
// misconfigured, so a client can never silently drift back to the wrong dataset.
//
// SAFETY: never logs or embeds the API key — it lives only inside the transport.

import { createClientTransport } from "@hasna/contracts/client";
import {
  createHasnaStorageClient,
  type HasnaStorageClient,
} from "@hasna/contracts/client/storage";

/** Transport overrides (test injection: fetchImpl, headers, timeout, retry). */
type StorageClientOverrides = Parameters<typeof createClientTransport>[2];

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
 * Returns `{ active: true, client }` only when HASNA_ECONOMY_API_URL +
 * HASNA_ECONOMY_API_KEY are both set (hosted route). Otherwise
 * `{ active: false }` (local store). Throws if hosted was requested but is
 * misconfigured.
 */
export function resolveEconomyCloudStorage(
  env: NodeJS.ProcessEnv = process.env,
  overrides?: StorageClientOverrides,
): EconomyCloudStorage {
  const wired = createClientTransport(ECONOMY_APP, env, overrides);
  if (wired.transport === "http") {
    return { active: true, client: createHasnaStorageClient(ECONOMY_APP, wired.client) };
  }
  // Fail closed: a hosted route requested but not resolvable must not silently
  // serve the local dataset (regression todos 4704ab9f). The modern resolver
  // marks the partial-flip case misconfigured instead of throwing, so the
  // misconfiguration surfaces as the same hard error here.
  if (wired.resolution.misconfigured) {
    throw new Error(wired.resolution.warning ?? "economy hosted route is misconfigured.");
  }
  return { active: false, client: null };
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
 * when the client is on the hosted route.
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
