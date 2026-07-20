// App-level cloud storage resolver.
//
// The fleet flip writes exactly two vars per app on a self_hosted machine:
//   HASNA_<APP>_API_URL   = https://<app>.<your-deployment-domain>
//   HASNA_<APP>_API_KEY   = <bearer key>
// (no STORAGE_MODE / DSN — the raw database URL is never shipped to clients).
//
// So the presence of BOTH an API URL and an API key IS the self_hosted signal:
// when they are set we route every read+write to the hosted `/v1` API; when they
// are unset we fall back to the local store. An explicit mode of `local`
// (HASNA_<APP>_STORAGE_MODE=local) is an escape hatch that forces local even if
// the API vars are present, so a flip is always reversible by unsetting the vars
// OR pinning mode=local.

import { envToken, type Env } from "./mode.js";
import { createHasnaStorageClient, type HasnaStorageClient } from "./storage.js";
import { createClientTransport } from "./transport.js";

export type CloudStorageResolution =
  | { transport: "local"; client: null }
  | { transport: "cloud-http"; client: HasnaStorageClient; baseUrl: string };

function firstValue(env: Env, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Resolve whether `name`'s data lives in the cloud (hosted `/v1` API) or the
 * local store for the current environment. Never returns partially-built cloud
 * state and never exposes the API key.
 */
export function resolveCloudStorage(name: string, env: Env = process.env): CloudStorageResolution {
  const token = envToken(name);
  const modeKeys = [`HASNA_${token}_STORAGE_MODE`];
  const apiUrlKeys = [`HASNA_${token}_API_URL`];
  const apiKeyKeys = [`HASNA_${token}_API_KEY`];

  const explicitMode = firstValue(env, modeKeys);
  // Explicit local pin wins — reversible escape hatch.
  if (explicitMode) {
    if (explicitMode === "local") return { transport: "local", client: null };
    if (explicitMode !== "self_hosted" && explicitMode !== "cloud") {
      throw new Error(`Unknown deployment mode: ${explicitMode}. Use local, self_hosted, or cloud.`);
    }
  }

  const apiUrl = firstValue(env, apiUrlKeys);
  const apiKey = firstValue(env, apiKeyKeys);
  const hasRemoteConfig = Boolean(explicitMode || apiUrl || apiKey);
  if (hasRemoteConfig && (!apiUrl || !apiKey)) {
    throw new Error(
      `Remote storage for ${name} requires both HASNA_${token}_API_URL and HASNA_${token}_API_KEY.`,
    );
  }
  if (!apiUrl || !apiKey) {
    return { transport: "local", client: null };
  }

  const transportEnv: Env = explicitMode
    ? env
    : { ...env, [`HASNA_${token}_STORAGE_MODE`]: "self_hosted" };
  const wired = createClientTransport(name, transportEnv);
  if (wired.transport !== "cloud-http") {
    throw new Error(`Remote storage for ${name} could not initialize the HTTP transport.`);
  }
  return {
    transport: "cloud-http",
    client: createHasnaStorageClient(name, wired.client),
    baseUrl: wired.client.baseUrl,
  };
}
