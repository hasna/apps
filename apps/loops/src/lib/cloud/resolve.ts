// App-level client storage resolver.
//
// The fleet flip writes exactly two vars per app on a server-backed machine:
//   HASNA_<APP>_API_URL   = https://<app>.<your-deployment-domain>
//   HASNA_<APP>_API_KEY   = <bearer key>
// (no DSN — the raw database URL is never shipped to clients).
//
// So the presence of BOTH an API URL and an API key IS the http signal: when
// they are set we route every read+write to the hosted `/v1` API; when they
// are unset we fall back to the on-box sqlite store. An explicit pin of
// `sqlite` (HASNA_<APP>_STORAGE_MODE=sqlite) is an escape hatch that forces
// the on-box file even if the API vars are present, so a flip is always
// reversible by unsetting the vars OR pinning the mode to sqlite.

import { envToken, normalizeStorageMode, type Env } from "./mode.js";
import { createHasnaStorageClient, type HasnaStorageClient } from "./storage.js";
import { createClientTransport } from "./transport.js";

export type CloudStorageResolution =
  | { transport: "sqlite"; client: null }
  | { transport: "http"; client: HasnaStorageClient; baseUrl: string };

function firstValue(env: Env, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Resolve whether `name`'s data lives behind the hosted `/v1` API or in the
 * on-box sqlite store for the current environment. Never returns
 * partially-built http state and never exposes the API key.
 */
export function resolveCloudStorage(name: string, env: Env = process.env): CloudStorageResolution {
  const token = envToken(name);
  const modeKeys = [`HASNA_${token}_STORAGE_MODE`];
  const apiUrlKeys = [`HASNA_${token}_API_URL`];
  const apiKeyKeys = [`HASNA_${token}_API_KEY`];

  const explicitRaw = firstValue(env, modeKeys);
  // Explicit sqlite pin wins — reversible escape hatch.
  const explicitMode = explicitRaw ? normalizeStorageMode(explicitRaw).mode : undefined;
  if (explicitMode === "sqlite") return { transport: "sqlite", client: null };

  const apiUrl = firstValue(env, apiUrlKeys);
  const apiKey = firstValue(env, apiKeyKeys);
  const hasRemoteConfig = Boolean(explicitMode || apiUrl || apiKey);
  if (hasRemoteConfig && (!apiUrl || !apiKey)) {
    throw new Error(
      `Remote storage for ${name} requires both HASNA_${token}_API_URL and HASNA_${token}_API_KEY.`,
    );
  }
  if (!apiUrl || !apiKey) {
    return { transport: "sqlite", client: null };
  }

  const transportEnv: Env = explicitMode
    ? env
    : { ...env, [`HASNA_${token}_STORAGE_MODE`]: "http" };
  const wired = createClientTransport(name, transportEnv);
  if (wired.transport !== "http") {
    throw new Error(`Remote storage for ${name} could not initialize the HTTP transport.`);
  }
  return {
    transport: "http",
    client: createHasnaStorageClient(name, wired.client),
    baseUrl: wired.client.baseUrl,
  };
}
