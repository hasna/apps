// The secrets Store resolver.
//
// `getStore()` decides ONE thing: local vault, or the hosted secrets API. It is
// the only place that decides; no CLI command, MCP tool, or SDK method branches
// on a mode. There is no mode: the retired `HASNA_SECRETS_STORAGE_MODE` /
// `*_MODE` family selects nothing at all any more (owner rulings 2026-09-04,
// hasna/apps#1720). The decision is:
//
//   • HASNA_SECRETS_LOCAL_VAULT=1 (explicit opt-in)  => LocalStore (sqlite),
//     announced on stderr with one clear line, and ONLY when no credential
//     resolves — a station that has a hosted credential is never silently
//     served local data.
//   • otherwise                                       => ApiStore, with the
//     credential and the authority resolved by @hasna/contracts (five tiers:
//     argument, env pointer, macOS Keychain, ~/.hasna/secrets/config/credentials,
//     HASNA_SECRETS_API_KEY). The base URL defaults to the fleet gateway
//     https://api.hasna.com/secrets once a credential resolves.
//   • no credential from any tier and no opt-in       => FAILS CLOSED (throw).
//
// FAIL-CLOSED DEFAULT (owner ruling 2026-09-04). A run WITHOUT a credential used
// to fall through to the LOCAL SQLite vault, print a `secrets-local-fallback`
// event on stderr and exit 0 — the false green that made agents in an
// unconfigured shell misdiagnose every hosted credential as missing (incident
// 715558). That default is gone: no credential and no explicit opt-in is a HARD
// ERROR naming every tier that was consulted, and no local file is opened.
//
// WHY THE OPT-IN STILL EXISTS, AND WHY IT IS NOT A MODE SWITCH. @hasna/secrets
// is a local encrypted vault by design — that is the product, not a fallback —
// so it is one of the apps the layout ruling allows to keep an unhosted lane.
// `HASNA_SECRETS_LOCAL_VAULT=1` is a deliberate operator act, the local-lane
// equivalent of passing `--api-key`; it never routes a hosted run, it cannot be
// set by the fleet profile, and (unlike the retired mode variables) it selects
// nothing when a credential resolves.

import {
  ClientTransportConfigurationError,
  clientTransportEnvKeys,
  credentialDiskSources,
  resolveCredential,
  resolveSecretsStorageClient,
} from "./client.js";
// TYPES come from the published spelling, never from @hasna/contracts directly:
// this module's declarations are reachable from the `./storage` export, and a
// build-time-only import there breaks every TS consumer (see ./client-types.ts).
import type { ClientTransportResolution, SecretsClientResolutionOptions } from "./client-types.js";
import { ApiStore } from "./api.js";
import { LocalStore } from "./local.js";
import { assertTestNetworkTargetAllowed } from "../test-isolation.js";
import type { Store } from "./types.js";

const APP_NAME = "secrets";

/**
 * The explicit opt-in for the LOCAL encrypted SQLite vault (owner ruling
 * 2026-09-04). The hosted secrets API is the only default: without a credential
 * from one of the five resolver tiers the process FAILS CLOSED instead of
 * silently serving local data. Setting this key to a truthy value (`1` or
 * `true`) is the documented way to choose the local vault on purpose.
 */
export const LOCAL_VAULT_OPT_IN_ENV_KEY = "HASNA_SECRETS_LOCAL_VAULT";

/** True when the caller explicitly opted into the local vault. */
export function localVaultOptedIn(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[LOCAL_VAULT_OPT_IN_ENV_KEY]?.trim().toLowerCase();
  return value === "1" || value === "true";
}

/**
 * The one line a local run prints, so an unhosted run can never be mistaken for
 * a hosted one that came back empty (owner ruling 2026-09-04). It goes to
 * stderr, so `--json` stdout stays machine-readable.
 */
export function localVaultNotice(): string {
  return (
    `secrets: local vault mode (${LOCAL_VAULT_OPT_IN_ENV_KEY}=1) — reading and writing the on-box ` +
    `encrypted vault. Secrets stored in the hosted vault are NOT included.`
  );
}

/**
 * The fail-closed error for a run with no credential and no local opt-in.
 *
 * The message is the documentation surface: it carries the resolver's own
 * diagnostic (which names the Keychain item, the credentials file it looked
 * for, and `HASNA_SECRETS_API_KEY`) and adds the local opt-in, which the shared
 * resolver cannot know about.
 */
export function credentialRequiredError(env: NodeJS.ProcessEnv, cause?: unknown): Error {
  const keys = clientTransportEnvKeys(APP_NAME);
  const detail =
    cause instanceof Error
      ? cause.message
      : `No API key could be resolved for '${APP_NAME}'. Looked in the Keychain (macOS only), then for a ` +
        `credential file at ${credentialDiskSources(APP_NAME, env as Record<string, string | undefined>).join(" or ") || "<no HOME set>"}, ` +
        `then for ${keys.apiKeyKeys[0]} in the environment.`;
  return new Error(
    `${detail} ` +
      `Set ${keys.apiKeyKeys[0]} (or store the key in the Keychain item ` +
      `hasna.credentials.${APP_NAME}.api-key, or in ~/.hasna/${APP_NAME}/config/credentials) to use the ` +
      `hosted secrets vault at ${keys.apiUrlKeys[0]} or the default gateway, ` +
      `or set ${LOCAL_VAULT_OPT_IN_ENV_KEY}=1 to explicitly opt into the local vault.`,
  );
}

/** The resolved Store plus the transport decision that selected it. */
export interface StoreResolution {
  store: Store;
  resolution: ClientTransportResolution | null;
  /** One line to print for a local run; null for a hosted one. */
  notice: string | null;
}

/**
 * Resolve the active Store for this process from the environment, together with
 * the transport resolution that chose it. Callers that must name the backing
 * store read `resolution` here — the alternative is a silent `new LocalStore()`
 * with no visibility of the switch.
 *
 * FAILS CLOSED: a `local` outcome is only returned when the caller explicitly
 * opted in via {@link LOCAL_VAULT_OPT_IN_ENV_KEY} AND no credential resolves.
 * Without a credential and without the opt-in this throws an actionable error
 * naming every tier that was consulted, and no local SQLite file is ever opened.
 */
export function getStoreWithResolution(
  env: NodeJS.ProcessEnv = process.env,
  options: SecretsClientResolutionOptions = {},
): StoreResolution {
  const clientEnv = env as Record<string, string | undefined>;

  // The local lane is checked first ONLY to answer "is this an unhosted run?" —
  // it still yields to a credential, so an opted-in station that also holds a
  // hosted key keeps talking to the hosted vault rather than quietly diverging
  // from it.
  if (localVaultOptedIn(env) && resolveCredential(APP_NAME, clientEnv, options.credentials) === null) {
    return { store: new LocalStore(), resolution: null, notice: localVaultNotice() };
  }

  let resolved;
  try {
    resolved = resolveSecretsStorageClient(APP_NAME, clientEnv, options);
  } catch (error) {
    if (error instanceof ClientTransportConfigurationError) {
      throw credentialRequiredError(env, error);
    }
    throw error;
  }

  // HC-00304: the AMBIENT process environment steering a test run onto the hosted
  // vault is the exact defect. Refuse it here, at the point of resolution, so the
  // failure names the cause instead of surfacing later as a mystery write. An env
  // object passed in explicitly is a caller's own fixture, not the ambient
  // environment, so it resolves normally — the transport's egress guard is what
  // stops that one from reaching a real host.
  if (env === process.env) {
    assertTestNetworkTargetAllowed(resolved.client.baseUrl, clientEnv);
  }
  return { store: new ApiStore(resolved.client), resolution: resolved.resolution, notice: null };
}

/** Resolve the active Store for this process from the environment. */
export function getStore(
  env: NodeJS.ProcessEnv = process.env,
  options: SecretsClientResolutionOptions = {},
): Store {
  return getStoreWithResolution(env, options).store;
}

/** True when reads/writes route to the cloud API rather than the local vault. */
export function isApiMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return getStore(env).mode === "api";
}

export type { Store } from "./types.js";
export { LocalStore } from "./local.js";
export { ApiStore, SecretDecryptionError } from "./api.js";
