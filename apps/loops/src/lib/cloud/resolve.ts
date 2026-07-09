// App-level cloud storage resolver.
//
// The fleet flip writes exactly two vars per app on a self_hosted machine:
//   HASNA_<APP>_API_URL   = https://<app>.hasna.xyz
//   HASNA_<APP>_API_KEY   = <bearer key>
// (no STORAGE_MODE / DSN — the raw database URL is never shipped to clients).
//
// So the presence of BOTH an API URL and an API key IS the self_hosted signal:
// when they are set we route every read+write to the hosted `/v1` API; when they
// are unset we fall back to the local store. An explicit mode of `local`
// (HASNA_<APP>_STORAGE_MODE=local) is an escape hatch that forces local even if
// the API vars are present, so a flip is always reversible by unsetting the vars
// OR pinning mode=local.

import { envToken, normalizeStorageMode, type Env } from "./mode.js";
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
  const modeKeys = [`HASNA_${token}_STORAGE_MODE`, `HASNA_${token}_MODE`, `${token}_STORAGE_MODE`, `${token}_MODE`];
  const apiUrlKeys = [`HASNA_${token}_API_URL`, `${token}_API_URL`];
  // Accept `_API_TOKEN` aliases too so the control-plane bearer secret
  // (LOOPS_API_TOKEN / HASNA_LOOPS_API_TOKEN, used by doctor/import/migration)
  // also enables read/write routing. Keep in sync with clientTransportEnvKeys().
  const apiKeyKeys = [
    `HASNA_${token}_API_KEY`,
    `${token}_API_KEY`,
    `HASNA_${token}_API_TOKEN`,
    `${token}_API_TOKEN`,
  ];

  const explicitMode = firstValue(env, modeKeys);
  // Explicit local pin wins — reversible escape hatch.
  if (explicitMode && normalizeStorageMode(explicitMode).mode === "local") {
    return { transport: "local", client: null };
  }

  const apiUrl = firstValue(env, apiUrlKeys);
  const apiKey = firstValue(env, apiKeyKeys);
  // Cloud requires BOTH url + key. Anything less → local (no silent drift).
  if (!apiUrl || !apiKey) {
    return { transport: "local", client: null };
  }

  // Synthesize a cloud-mode env so the vendored transport resolves to cloud-http.
  const cloudEnv: Env = { ...env, [`HASNA_${token}_STORAGE_MODE`]: "self_hosted" };
  const wired = createClientTransport(name, cloudEnv);
  if (wired.transport !== "cloud-http") {
    return { transport: "local", client: null };
  }
  return {
    transport: "cloud-http",
    client: createHasnaStorageClient(name, wired.client),
    baseUrl: wired.client.baseUrl,
  };
}
