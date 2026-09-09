// Ordinary CLI, MCP and default library access use the shared API only.
import {
  ClientTransportConfigurationError,
  clientTransportEnvKeys,
  credentialDiskSources,
  resolveSecretsStorageClient,
} from "./client.js";
// TYPES come from the published spelling, never from @hasna/contracts directly:
// this module's declarations are reachable from the `./storage` export, and a
// build-time-only import there breaks every TS consumer (see ./client-types.ts).
import type { ClientTransportResolution, SecretsClientResolutionOptions } from "./client-types.js";
import { ApiStore } from "./api.js";
import { assertTestNetworkTargetAllowed } from "../test-isolation.js";
import type { Store } from "./types.js";

const APP_NAME = "secrets";

/** Deprecated selector name retained for consumers to recognize and remove it. */
export const LOCAL_VAULT_OPT_IN_ENV_KEY = "HASNA_SECRETS_LOCAL_VAULT";
const LOCAL_SELECTORS = [LOCAL_VAULT_OPT_IN_ENV_KEY, "HASNA_SECRETS_DB_PATH", "OPEN_SECRETS_DB"] as const;

/** Ordinary clients never select a vault from ambient machine-local settings. */
export function assertSharedStoreSelection(env: NodeJS.ProcessEnv = process.env): void {
  const selected = LOCAL_SELECTORS.filter(key => env[key] !== undefined && env[key] !== "");
  if (selected.length) throw new Error(`Local vault selectors are no longer supported by Secrets clients: ${selected.join(", ")}. Remove them and configure HASNA_SECRETS_API_URL / HASNA_SECRETS_API_KEY or saved account credentials. Use migrate-vault --source for an explicit existing vault.`);
}

export function assertSharedStoreArguments(args: string[]): void {
  const separator = args.indexOf("--");
  const ownArgs = separator === -1 ? args : args.slice(0, separator);
  if (ownArgs.some(arg => /^(--local|--local-vault|--db|--db-path|--storage-mode)(=|$)/.test(arg))) {
    throw new Error("Local vault selection flags are no longer supported. Use saved API credentials, or migrate-vault --source for an existing vault.");
  }
}

export function credentialRequiredError(env: NodeJS.ProcessEnv, cause?: unknown): Error {
  const keys = clientTransportEnvKeys(APP_NAME);
  const detail = cause instanceof Error ? cause.message : `No API credential resolved. Checked ${credentialDiskSources(APP_NAME,env).join(" or ") || "saved account credentials"}.`;
  return new Error(`${detail} Configure ${keys.apiUrlKeys[0]} / ${keys.apiKeyKeys[0]} or save account credentials in the Keychain or ~/.hasna/secrets/config/credentials. No local vault is opened.`);
}

/** The resolved Store plus the transport decision that selected it. */
export interface StoreResolution {
  store: Store;
  resolution: ClientTransportResolution | null;
  /** Retained compatibility field; ordinary API resolution returns null. */
  notice: string | null;
}

/** Resolve the shared API store. Explicit LocalStore library handles are separate. */
export function getStoreWithResolution(
  env: NodeJS.ProcessEnv = process.env,
  options: SecretsClientResolutionOptions = {},
): StoreResolution {
  const clientEnv = env as Record<string, string | undefined>;

  assertSharedStoreSelection(env);

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

/** Compatibility helper: ordinary resolution returns API or throws a setup error. */
export function isApiMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return getStore(env).mode === "api";
}

export type { Store } from "./types.js";
export { LocalStore } from "./local.js";
export { ApiStore, SecretDecryptionError } from "./api.js";
