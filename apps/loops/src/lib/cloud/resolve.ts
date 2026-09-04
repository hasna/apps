// App-level cloud storage resolver.
//
// The fleet flip writes exactly two vars per app:
//   HASNA_<APP>_API_URL   = https://<app>.<your-deployment-domain>
//   HASNA_<APP>_API_KEY   = <bearer key>
// (no STORAGE_MODE / DSN — the raw database URL is never shipped to clients).
//
// The presence of BOTH an API URL and an API key IS the API-connection signal:
// when they are set we route every read+write to the hosted `/v1` API.
//
// FAIL-CLOSED DEFAULT (owner ruling 2026-09-04): the client data path NEVER
// silently falls back to the on-box SQLite file when the API env is absent. A
// process with neither API variable and no explicit selection throws an
// actionable error naming the required env instead of serving
// ~/.hasna/loops/loops.db at exit 0. The local file connection remains
// available, but only as an EXPLICIT opt-in:
//   HASNA_<APP>_CONNECTION=file
// (values: `file` | `api`; `api` still requires both API variables). Setting
// the opt-in alongside the flip vars is a contradiction and is rejected, so a
// flipped machine can never silently downgrade to the local file.
//
// A leftover `HASNA_LOOPS_STORAGE_MODE` (retired in 0.5.0) is rejected here on
// the client data path with the same hard error the runtime-config surface
// uses, so a stale env fails loudly instead of silently resolving to the
// local file store.

import { clientTransportEnvKeys, createClientTransport } from "@hasna/contracts/client";
// Mirrors the seam's own Env definition; not re-exported from the client
// subpath in the installed kit (0.10.x).
type Env = Record<string, string | undefined>;
import { createHasnaStorageClient, type HasnaStorageClient } from "@hasna/contracts/client/storage";
import { assertNoRetiredStorageMode } from "../runtime-config.js";

export type CloudStorageResolution =
  | { transport: "file"; client: null }
  | { transport: "api"; client: HasnaStorageClient; baseUrl: string };

const FILE_CONNECTION = "file";
const API_CONNECTION = "api";
const CONNECTION_VALUES = [FILE_CONNECTION, API_CONNECTION] as const;

function firstValue(env: Env, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** `loops` -> `HASNA_LOOPS_CONNECTION`; the explicit connection-selection env key. */
function connectionEnvKey(name: string): string {
  return `HASNA_${name.toUpperCase().replace(/-/g, "_")}_CONNECTION`;
}

interface ConnectionSignals {
  apiUrl: string | undefined;
  apiKey: string | undefined;
  connection: string | undefined;
}

/**
 * The fail-closed connection policy, shared by the store resolver and the
 * client commands that report the connection (status). Returns the error to
 * throw, or undefined when the connection is explicitly configured. The API
 * key value never appears in any message.
 */
function connectionPolicyError(name: string, env: Env): Error | undefined {
  const keys = clientTransportEnvKeys(name);
  const signals: ConnectionSignals = {
    apiUrl: firstValue(env, keys.apiUrlKeys),
    apiKey: firstValue(env, keys.apiKeyKeys),
    connection: firstValue(env, [connectionEnvKey(name)]),
  };
  const { apiUrl, apiKey, connection } = signals;
  const connKey = connectionEnvKey(name);
  const urlKey = keys.apiUrlKeys[0]!;
  const keyKey = keys.apiKeyKeys[0]!;

  if (connection && !CONNECTION_VALUES.includes(connection as (typeof CONNECTION_VALUES)[number])) {
    return new Error(`${connKey} must be ${CONNECTION_VALUES.map((v) => `'${v}'`).join(" or ")}; got "${connection}".`);
  }
  if (connection === FILE_CONNECTION && (apiUrl || apiKey)) {
    return new Error(
      `${connKey}=file conflicts with ${urlKey} and ${keyKey}: select exactly one connection. ` +
        `Unset ${urlKey}/${keyKey} to keep the explicit local file connection, or unset ${connKey} to keep the hosted API.`,
    );
  }
  if (connection === API_CONNECTION && (!apiUrl || !apiKey)) {
    return new Error(
      `${connKey}=api requires both ${urlKey} and ${keyKey}.`,
    );
  }
  if (connection === FILE_CONNECTION) {
    // Explicit file opt-in with no API variables (the contradiction above is
    // already rejected): valid, resolution proceeds to the file transport.
    return undefined;
  }
  if (Boolean(apiUrl || apiKey) && (!apiUrl || !apiKey)) {
    return new Error(
      `Remote storage for ${name} requires both ${urlKey} and ${keyKey}.`,
    );
  }
  if (!apiUrl || !apiKey) {
    // Neither API variable AND no explicit file opt-in: fail closed instead of
    // silently serving the on-box sqlite file at exit 0.
    return new Error(
      `no ${name} client connection is configured: set ${urlKey} and ${keyKey} to connect to the hosted ${name} API, ` +
        `or set ${connKey}=file to explicitly use this machine's local file store.`,
    );
  }
  return undefined;
}

/** Throw when the client connection for `name` is not explicitly configured. */
export function requireConfiguredConnection(name: string, env: Env = process.env): void {
  assertNoRetiredStorageMode(env);
  const error = connectionPolicyError(name, env);
  if (error) throw error;
}

/**
 * Resolve whether `name`'s data lives behind the hosted `/v1` API or in the
 * explicitly selected local store for the current environment. Never returns
 * partially-built remote state and never exposes the API key.
 */
export function resolveCloudStorage(name: string, env: Env = process.env): CloudStorageResolution {
  assertNoRetiredStorageMode(env);
  const error = connectionPolicyError(name, env);
  if (error) throw error;
  // Ask the seam for the exact key names it polices, so this resolver can
  // never drift from the shared client contract.
  const keys = clientTransportEnvKeys(name);
  const apiUrl = firstValue(env, keys.apiUrlKeys);
  const apiKey = firstValue(env, keys.apiKeyKeys);

  if (!apiUrl || !apiKey) {
    // Explicit file opt-in (HASNA_<APP>_CONNECTION=file): connectionPolicyError
    // already guaranteed no API variable is present alongside it.
    return { transport: "file", client: null };
  }

  const wired = createClientTransport(name, env);
  if (wired.transport !== "http") {
    throw new Error(`Remote storage for ${name} could not initialize the HTTP transport.`);
  }
  return {
    transport: "api",
    client: createHasnaStorageClient(name, wired.client),
    baseUrl: wired.client.baseUrl,
  };
}
