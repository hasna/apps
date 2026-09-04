// Client-side storage resolver for @hasna/economy.
//
// When the contracts client seam resolves to the `http` transport
// (HASNA_ECONOMY_API_URL + HASNA_ECONOMY_API_KEY are set), the CLI must route
// its reads and writes to the configured cloud API with the bearer key — NOT
// to the local SQLite store, and NEVER to a raw database DSN.
//
// This module is the single seam the CLI consults. It returns a ready
// `HasnaStorageClient` (from @hasna/contracts) when the http transport is active.
// Any other resolution FAILS CLOSED (owner directive 2026-09-04): without the
// fleet API environment the CLI throws an error naming the required variables
// instead of silently serving the local SQLite store, so no data path can drift
// back to an unintended local dataset with a false-green exit. The on-box local
// store is reachable only through the EXPLICIT local opt-in documented in
// docs/configuration.md — `HASNA_ECONOMY_LOCAL=1` (alias `ECONOMY_LOCAL=1`) —
// which returns `{ active: false }` so the caller uses `LocalStore`. A
// misconfigured resolution (API URL set without a key, or an invalid URL)
// throws regardless of the opt-in, via resolveStorageClient. Retired
// `*_STORAGE_MODE` / `*_MODE` variables are a hard error here too (owner
// directive 2026-07-29): deployment modes no longer exist, the transport is
// selected by URL + key alone, and a leftover mode variable must not be
// silently ignored.
//
// SAFETY: never logs or embeds the API key — it lives only inside the transport.

import { resolveStorageClient, type HasnaStorageClient } from "./contracts-client/storage.js";

/** Transport overrides (test injection: fetchImpl, headers, timeout, retry). */
type StorageClientOverrides = Parameters<typeof resolveStorageClient>[2];

/** The economy app slug used for the HASNA_<APP>_* env lookups. */
export const ECONOMY_APP = "economy";

/** Retired client storage-mode variables — naming one in an error is the guard. */
const RETIRED_STORAGE_MODE_KEYS = [
  "HASNA_ECONOMY_STORAGE_MODE",
  "HASNA_ECONOMY_MODE",
  "ECONOMY_STORAGE_MODE",
  "ECONOMY_MODE",
] as const;

function assertNoRetiredStorageMode(env: NodeJS.ProcessEnv): void {
  const legacyKey = RETIRED_STORAGE_MODE_KEYS.find(
    (key) => Object.hasOwn(env, key) && env[key] !== undefined,
  );
  if (!legacyKey) return;
  throw new Error(
    `${legacyKey} was removed. Deployment modes no longer exist: delete the storage-mode variable. ` +
      `The client routes through the HTTP API selected by HASNA_ECONOMY_API_URL + ` +
      `HASNA_ECONOMY_API_KEY, or serves the local SQLite store only when ` +
      `HASNA_ECONOMY_LOCAL=1 is set.`,
  );
}

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

/**
 * Explicit local-store opt-in variables. The on-box SQLite store is served
 * only when one of these is set to a truthy value; without either of them (and
 * without the fleet API environment) the client fails closed.
 */
export const LOCAL_STORAGE_OPT_IN_KEYS = ["HASNA_ECONOMY_LOCAL", "ECONOMY_LOCAL"] as const;

/** Truthy env-flag parse: set, non-blank, and not 0/false/no/off (any case). */
function envFlagSet(env: NodeJS.ProcessEnv, key: string): boolean {
  const raw = env[key];
  if (raw === undefined) return false;
  const value = raw.trim().toLowerCase();
  return value !== "" && value !== "0" && value !== "false" && value !== "no" && value !== "off";
}

function localStorageExplicitlyOptedIn(env: NodeJS.ProcessEnv): boolean {
  return LOCAL_STORAGE_OPT_IN_KEYS.some((key) => envFlagSet(env, key));
}

let cache: EconomyCloudStorage | undefined;

/**
 * Resolve the economy client storage transport for the current environment.
 *
 * Returns `{ active: true, client }` only when the contracts seam resolves to
 * the http transport (HASNA_ECONOMY_API_URL + HASNA_ECONOMY_API_KEY set).
 * Returns `{ active: false }` (local store) only when the explicit local
 * opt-in (`HASNA_ECONOMY_LOCAL=1` / `ECONOMY_LOCAL=1`) is set. Throws in every
 * other unconfigured case — the error names the required API environment so a
 * missing-env run can never silently serve the local dataset. A resolution the
 * contracts seam reports as misconfigured (API URL without a key, or an
 * invalid URL) throws regardless of the opt-in.
 */
export function resolveEconomyCloudStorage(
  env: NodeJS.ProcessEnv = process.env,
  overrides?: StorageClientOverrides,
): EconomyCloudStorage {
  assertNoRetiredStorageMode(env);
  const resolved = resolveStorageClient(ECONOMY_APP, env, overrides);
  if (resolved.transport === "http") return { active: true, client: resolved.client };
  // A clean non-http resolution means the seam found no API environment. That
  // is a fail-closed event unless local storage was explicitly opted into:
  // silently serving ~/.hasna/economy/economy.db here is the false-green path
  // this guard exists to remove.
  if (localStorageExplicitlyOptedIn(env)) return { active: false, client: null };
  throw new Error(
    "No economy API environment is configured and local mode is not enabled. " +
      "The economy CLI fails closed instead of silently serving the local SQLite store: " +
      "set HASNA_ECONOMY_API_URL and HASNA_ECONOMY_API_KEY (unprefixed " +
      "ECONOMY_API_URL / ECONOMY_API_KEY aliases are accepted) to route CLI and MCP " +
      "data operations through the shared economy API, or set " +
      "HASNA_ECONOMY_LOCAL=1 (alias ECONOMY_LOCAL=1) to explicitly opt in to the " +
      "on-box local store.",
  );
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
 * when the client is on the http transport.
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
