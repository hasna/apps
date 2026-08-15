// App-level cloud storage resolver.
//
// The fleet flip writes exactly two vars per app:
//   HASNA_<APP>_API_URL   = https://<app>.<your-deployment-domain>
//   HASNA_<APP>_API_KEY   = <bearer key>
// (no STORAGE_MODE / DSN — the raw database URL is never shipped to clients).
//
// So the presence of BOTH an API URL and an API key IS the API-connection
// signal: when they are set we route every read+write to the hosted `/v1` API;
// when they are unset we fall back to the local store. A flip is always
// reversible by unsetting the vars.
//
// A leftover `HASNA_LOOPS_STORAGE_MODE` (retired in 0.5.0) is rejected here on
// the client data path with the same hard error the runtime-config surface
// uses, so a stale env fails loudly instead of silently resolving to the
// local file store.

import { envToken, type Env } from "./transport.js";
import { createHasnaStorageClient, type HasnaStorageClient } from "./storage.js";
import { createClientTransport } from "./transport.js";
import { assertNoRetiredStorageMode } from "../runtime-config.js";

export type CloudStorageResolution =
  | { transport: "file"; client: null }
  | { transport: "api"; client: HasnaStorageClient; baseUrl: string };

function firstValue(env: Env, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Resolve whether `name`'s data lives behind the hosted `/v1` API or in the
 * local store for the current environment. Never returns partially-built
 * remote state and never exposes the API key.
 */
export function resolveCloudStorage(name: string, env: Env = process.env): CloudStorageResolution {
  assertNoRetiredStorageMode(env);
  const token = envToken(name);
  const apiUrlKeys = [`HASNA_${token}_API_URL`];
  const apiKeyKeys = [`HASNA_${token}_API_KEY`];

  const apiUrl = firstValue(env, apiUrlKeys);
  const apiKey = firstValue(env, apiKeyKeys);
  const hasRemoteConfig = Boolean(apiUrl || apiKey);
  if (hasRemoteConfig && (!apiUrl || !apiKey)) {
    throw new Error(
      `Remote storage for ${name} requires both HASNA_${token}_API_URL and HASNA_${token}_API_KEY.`,
    );
  }
  if (!apiUrl || !apiKey) {
    return { transport: "file", client: null };
  }

  const wired = createClientTransport(name, env);
  if (wired.transport !== "api") {
    throw new Error(`Remote storage for ${name} could not initialize the HTTP transport.`);
  }
  return {
    transport: "api",
    client: createHasnaStorageClient(name, wired.client),
    baseUrl: wired.client.baseUrl,
  };
}
