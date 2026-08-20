// App-level cloud storage resolver.
//
// The fleet flip writes exactly two vars per app on an API-flipped machine:
//   HASNA_<APP>_API_URL   = https://<app>.<your-deployment-domain>
//   HASNA_<APP>_API_KEY   = <bearer key>
// (no STORAGE_MODE / DSN — the raw database URL is never shipped to clients).
//
// So the presence of an API URL with a resolvable credential IS the API-client
// signal: when it resolves we route every read+write to the hosted `/v1` API;
// otherwise we fall back to the local store. An API URL without a credential
// is misconfigured and fails closed (the shared seam throws). An API key with
// no API URL is a stray partial pair and throws naming the missing URL — a
// partial pair must never silently fall back to local data. Any set
// storage-mode variable throws first via the shared seam (deployment modes
// were removed, owner directive 2026-07-29).

import { clientTransportEnvKeys, createClientTransport } from "./transport.js";
import { createHasnaStorageClient, type HasnaStorageClient } from "./storage.js";
import { assertNoLegacyStorageMode } from "../lib/retired-storage-mode.js";
import type { Env } from "./mode.js";

export type CloudStorageResolution =
  | { transport: "local"; client: null }
  | { transport: "cloud-http"; client: HasnaStorageClient; baseUrl: string };

/**
 * Resolve whether `name`'s data lives in the cloud (hosted `/v1` API) or the
 * local store for the current environment. Never returns partially-built cloud
 * state and never exposes the API key. Throws on a partial API env pair or a
 * set storage-mode variable.
 */
export function resolveCloudStorage(name: string, env: Env = process.env): CloudStorageResolution {
  assertNoLegacyStorageMode(env as NodeJS.ProcessEnv);
  const wired = createClientTransport(name, env);
  if (wired.transport === "http") {
    return {
      transport: "cloud-http",
      client: createHasnaStorageClient(name, wired.client),
      baseUrl: wired.client.baseUrl,
    };
  }
  if (wired.resolution.apiKeyPresent && !wired.resolution.apiUrlSource) {
    const keys = clientTransportEnvKeys(name);
    throw new Error(
      `${keys.apiUrlKeys[0]} is not set alongside ${keys.apiKeyKeys[0]}; a partial API env pair must never silently fall back to local data.`,
    );
  }
  return { transport: "local", client: null };
}
