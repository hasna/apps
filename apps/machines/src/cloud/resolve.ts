// App-level cloud storage resolver.
//
// The fleet flip writes exactly two vars per app on an API-flipped machine:
//   HASNA_<APP>_API_URL   = https://<app>.<your-deployment-domain>
//   HASNA_<APP>_API_KEY   = <bearer key>
// (no STORAGE_MODE / DSN — the raw database URL is never shipped to clients).
//
// So the presence of BOTH an API URL and an API key IS the API-client signal:
// when they are set we route every read+write to the hosted `/v1` API; when
// they are unset we fall back to the local store; exactly one set throws
// naming the missing variable — a partial pair must never silently fall back
// to local data. Any set storage-mode variable throws first via
// `assertNoLegacyStorageMode` (deployment modes were removed, owner directive
// 2026-07-29).

import { assertNoLegacyStorageMode } from "../lib/retired-storage-mode.js";
import type { Env } from "./mode.js";
import { createHasnaStorageClient, type HasnaStorageClient } from "./storage.js";
import { createClientTransport } from "./transport.js";

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
  if (wired.transport === "cloud-http") {
    return {
      transport: "cloud-http",
      client: createHasnaStorageClient(name, wired.client),
      baseUrl: wired.client.baseUrl,
    };
  }
  return { transport: "local", client: null };
}
