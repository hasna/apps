// The secrets Store resolver.
//
// `getStore()` reads the client-flip env and returns the correct transport:
//
//   • HASNA_SECRETS_API_URL + HASNA_SECRETS_API_KEY  => ApiStore (HTTP /v1 + key)
//   • HASNA_SECRETS_LOCAL_VAULT=1 (explicit opt-in)   => LocalStore (sqlite)
//   • neither                                          => FAILS CLOSED (throw)
//
// This is the ONE place that decides transport. No CLI command, MCP tool, or SDK
// method branches on mode; they all call methods on the resolved Store. Retired
// `HASNA_SECRETS_STORAGE_MODE`-family variables are a hard error (deployment
// modes no longer exist), and a half-applied flip (e.g. URL set, key missing)
// makes the vendored resolver throw instead of silently reading local data.
//
// FAIL-CLOSED DEFAULT (owner ruling 2026-09-04). A run WITHOUT the hosted API
// env used to fall through to the LOCAL SQLite vault, print a
// `secrets-local-fallback` event on stderr and exit 0 — the false green that
// made agents in an unconfigured shell misdiagnose every hosted credential as
// missing (incident 715558). That default is gone: no API env and no explicit
// opt-in is a HARD ERROR naming the required env, and no local file is opened.
// The local vault is reachable only through the explicit
// `HASNA_SECRETS_LOCAL_VAULT=1` opt-in (standalone/offline use, local
// serve/MCP bridges, and tests that exercise the local store).

import { resolveStorageClient, type ClientTransportResolution } from "./contracts-client/index.js";
import { clientTransportEnvKeys } from "./contracts-client/transport.js";
import { ApiStore } from "./api.js";
import { LocalStore } from "./local.js";
import { assertTestNetworkTargetAllowed } from "../test-isolation.js";
import type { Store } from "./types.js";

const APP_NAME = "secrets";

/**
 * The explicit opt-in for the LOCAL encrypted SQLite vault (owner ruling
 * 2026-09-04). The hosted secrets API is the only default: without
 * `HASNA_SECRETS_API_URL` + `HASNA_SECRETS_API_KEY` the process FAILS CLOSED
 * instead of silently serving local data. Setting this key to a truthy value
 * (`1` or `true`) is the documented way to choose the local vault on purpose.
 * The retired `HASNA_SECRETS_STORAGE_MODE` / `*_MODE` family is NOT a local
 * selector — those remain a hard error in the transport resolver.
 */
export const LOCAL_VAULT_OPT_IN_ENV_KEY = "HASNA_SECRETS_LOCAL_VAULT";

/** True when the caller explicitly opted into the local vault. */
export function localVaultOptedIn(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[LOCAL_VAULT_OPT_IN_ENV_KEY]?.trim().toLowerCase();
  return value === "1" || value === "true";
}

/**
 * The fail-closed error for a run that has neither the hosted API env pair nor
 * the explicit local-vault opt-in. The message is the documentation surface:
 * it names the required env and the opt-in.
 */
export function localVaultRequiresOptInError(env: NodeJS.ProcessEnv): Error {
  const keys = clientTransportEnvKeys(APP_NAME);
  const [urlKey, ...urlAliases] = keys.apiUrlKeys;
  const [keyKey, ...keyAliases] = keys.apiKeyKeys;
  const aliasNote =
    urlAliases.length > 0 || keyAliases.length > 0
      ? ` (aliases: ${[...urlAliases, ...keyAliases].join(", ")})`
      : "";
  return new Error(
    `${urlKey} and ${keyKey} are not set, so the hosted secrets API is not configured${aliasNote}. ` +
      `Failing closed: refusing to read or write the local vault. ` +
      `Set ${urlKey} + ${keyKey} to use the hosted secrets vault, ` +
      `or set ${LOCAL_VAULT_OPT_IN_ENV_KEY}=1 to explicitly opt into the local vault.`,
  );
}

/** The resolved Store plus the transport decision that selected it. */
export interface StoreResolution {
  store: Store;
  resolution: ClientTransportResolution;
}

/**
 * Resolve the active Store for this process from the environment, together with
 * the transport resolution that chose it. Callers that must name the backing
 * store read `resolution` here — the alternative is a silent
 * `new LocalStore()` with no visibility of the switch.
 *
 * The resolution FAILS CLOSED (owner ruling 2026-09-04): a `local` outcome is
 * only returned when the caller explicitly opted in via
 * {@link LOCAL_VAULT_OPT_IN_ENV_KEY}. Without the hosted API env pair and
 * without the opt-in this throws an actionable error naming the required env,
 * and no local SQLite file is ever opened.
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
  if (!localVaultOptedIn(env)) {
    throw localVaultRequiresOptInError(env);
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
