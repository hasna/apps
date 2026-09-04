// The secrets Store resolver.
//
// `getStore()` reads the client-flip env and returns the correct transport:
//
//   • HASNA_SECRETS_API_URL + HASNA_SECRETS_API_KEY  => ApiStore (HTTP /v1 + key)
//   • otherwise                                        => LocalStore (sqlite)
//
// This is the ONE place that decides transport. No CLI command, MCP tool, or SDK
// method branches on mode; they all call methods on the resolved Store. Retired
// `HASNA_SECRETS_STORAGE_MODE`-family variables are a hard error (deployment
// modes no longer exist), and a half-applied flip (e.g. URL set, key missing)
// makes the vendored resolver throw instead of silently reading local data.

import { resolveStorageClient, type ClientTransportResolution } from "./contracts-client/index.js";
import { ApiStore } from "./api.js";
import { LocalStore } from "./local.js";
import { assertTestNetworkTargetAllowed } from "../test-isolation.js";
import type { Store } from "./types.js";

const APP_NAME = "secrets";

/** The resolved Store plus the transport decision that selected it. */
export interface StoreResolution {
  store: Store;
  resolution: ClientTransportResolution;
}

/**
 * Resolve the active Store for this process from the environment, together with
 * the transport resolution that chose it. Callers that must name the backing
 * store (the CLI's local-fallback notice) read `resolution` here — the
 * alternative is a silent `new LocalStore()` with no visibility of the switch.
 */
export function getStoreWithResolution(env: NodeJS.ProcessEnv = process.env): StoreResolution {
  const resolved = resolveStorageClient(APP_NAME, env as Record<string, string | undefined>);
  if (resolved.transport === "cloud-http") {
    // HC-00304: the AMBIENT process environment steering a test run onto the hosted
    // vault is the exact defect. Refuse it here, at the point of resolution, so the
    // failure names the cause instead of surfacing later as a mystery write. An env
    // object passed in explicitly is a caller's own fixture, not the ambient
    // environment, so it resolves normally — the transport's egress guard is what
    // stops that one from reaching a real host.
    if (env === process.env) {
      assertTestNetworkTargetAllowed(resolved.client.baseUrl, env as Record<string, string | undefined>);
    }
    return { store: new ApiStore(resolved.client), resolution: resolved.resolution };
  }
  return { store: new LocalStore(), resolution: resolved.resolution };
}

/** Resolve the active Store for this process from the environment. */
export function getStore(env: NodeJS.ProcessEnv = process.env): Store {
  return getStoreWithResolution(env).store;
}

/** True when reads/writes route to the cloud API rather than the local vault. */
export function isApiMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return getStore(env).mode === "api";
}

export type { Store } from "./types.js";
export { LocalStore } from "./local.js";
export { ApiStore, SecretDecryptionError } from "./api.js";
