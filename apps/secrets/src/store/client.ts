// The one seam between @hasna/secrets and the shared Hasna client resolver.
//
// WHAT THIS REPLACED. Until #1720 this directory held a VENDORED copy of
// @hasna/contracts' `client/{transport,storage}.ts` (src/store/contracts-client/,
// ~750 lines, pinned at the v0.5.0 shape). A vendored resolver is a second
// spelling of the credential contract, and it drifted: it still knew about
// retired `*_STORAGE_MODE` / `*_MODE` switches, it had no Keychain tier, no
// `~/.hasna/<app>/config/credentials` tier and no default gateway authority, so
// on a station whose credential lives in the Keychain `secrets list` failed
// closed while `todos list` in the same shell worked. The copy is gone; the
// package now imports the resolver merged in hasna/apps#1723 and released as
// @hasna/contracts 1.0.1.
//
// WHAT THIS MODULE PUBLISHES, AND WHAT IT ONLY IMPORTS. @hasna/contracts is a
// BUILD-TIME dependency: `bun build --target bun` inlines the resolver, so the
// shipped bundles import node builtins only. The declarations `tsc` emits are
// not bundled, so anything this module names in an EXPORTED type signature
// would land in `dist/**/*.d.ts` as a live `@hasna/contracts` import and break
// every TS consumer, which installs this package's runtime dependencies and not
// its devDependencies. The contracts VALUES below are therefore re-exported for
// this package's own modules (an import in a function body is erased from a
// declaration), while every TYPE that crosses the published boundary is spelled
// in ./client-types.ts and re-exported from there. `./client-types.test.ts`
// asserts the two spellings are the same types, in both directions.
//
// THE FIVE TIERS the resolver applies, in order, FRESH ON EVERY CALL:
//   1. an explicit argument            — `apiKey` / `profile` passed in code
//   2. a deliberate env pointer        — HASNA_SECRETS_API_KEY_OVERRIDE,
//                                        HASNA_PROFILE, HASNA_SECRETS_API_KEY_REF
//   3. the macOS Keychain (darwin)     — `hasna.credentials.secrets.api-key`,
//                                        account HASNA_STATION -> `hostname -s` -> USER
//   4. disk                            — ~/.hasna/secrets/config/credentials
//                                        (HASNA_HOME / HASNA_CONFIG_HOME override;
//                                        XDG is never consulted)
//   5. HASNA_SECRETS_API_KEY in the env — legitimate, no deprecation notice
//
// The authority follows the same ladder — HASNA_SECRETS_API_URL, the Keychain
// `api-url` item, the credentials file — and DEFAULTS to the fleet gateway
// `https://api.hasna.com/secrets` once a credential resolves (the client
// appends `/v1`). Retired locations (~/.hasna/fleet-env, ~/.hasna/cloud,
// ~/.config/hasna) are never read, and no `*_MODE` / `*_STORAGE_MODE` variable
// selects anything: the transport is decided by URL + key alone.
//
// THE ONE DELIBERATE LOCAL ADDITION (HC-00304). `resolveSecretsStorageClient`
// calls the shared `createClientTransport` with `guardedFetch` from
// ../test-isolation.js as the transport's fetch. This is the package's single
// network egress point, and a test process must be structurally unable to reach
// a vault that is not on this machine. It is an INJECTED OPTION, not a fork: no
// resolution logic lives here, and the wrapper is deliberately NOT named
// `resolveStorageClient` so it can never be read — by a human or by the
// credential-seam conformance gate — as a second definition of the seam.

import {
  appConfigDiskValue,
  clientTransportEnvKeys,
  createClientTransport,
  keychainConfigValue,
} from "@hasna/contracts/client";
import { createHasnaStorageClient } from "@hasna/contracts/client/storage";
import { guardedFetch } from "../test-isolation.js";
import type {
  ClientEnv,
  ClientTransportResolution,
  HasnaStorageClient,
  SecretsClientResolutionOptions,
} from "./client-types.js";

// Runtime values, for this package's own modules only. A consumer never reaches
// these: they are bundled, not re-exported from a published entry point.
export {
  ClientTransportConfigurationError,
  clientTransportEnvKeys,
  createHasnaHttpTransport,
  credentialDiskSources,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
  HasnaHttpError,
  resolveClientTransport,
  resolveCredential,
  CREDENTIAL_PROFILE_ENV_KEY,
  HASNA_CONFIG_HOME_ENV_KEY,
  HASNA_HOME_ENV_KEY,
  KEYCHAIN_STATION_ENV_KEY,
} from "@hasna/contracts/client";

// The published type spelling. Every one of these is asserted identical to the
// @hasna/contracts declaration it mirrors by ./client-types.test.ts.
export type {
  ClientEnv,
  ClientTransportEnvKeys,
  ClientTransportKind,
  ClientTransportResolution,
  CredentialChainOptions,
  CredentialProvider,
  CredentialTier,
  HasnaHttpTransport,
  HasnaRequestOptions,
  HasnaStorageClient,
  KeychainCommandResult,
  KeychainCommandRunner,
  QueryParams,
  ResolvedCredential,
  SecretsClientResolutionOptions,
  StorageListResult,
} from "./client-types.js";

/**
 * True when SOMETHING configures a hosted authority for this app: the
 * `HASNA_<NAME>_API_URL` env key (or its one accepted alias), the Keychain
 * `api-url` item, or the `~/.hasna/<app>/config/credentials` file.
 *
 * It asks the SAME three sources, in the same order and through the same
 * @hasna/contracts entry points, that `resolveClientTransport` consults before
 * it falls back to the fleet gateway; the gateway default is deliberately NOT
 * one of them, because a default that always applies would make this always
 * true. A declared-but-unusable authority counts as configured — the run must
 * fail loudly on it rather than be routed somewhere else.
 *
 * The local-vault lane is the only caller: the owner ruling makes the unhosted
 * lane available only when NO url and NO key resolve.
 */
export function hostedAuthorityConfigured(
  name: string,
  env: ClientEnv,
  options: SecretsClientResolutionOptions = {},
): boolean {
  const keys = clientTransportEnvKeys(name);
  if (keys.apiUrlKeys.some((key) => (env[key] ?? "").trim().length > 0)) return true;
  if (keychainConfigValue(name, env, options.credentials?.keychain) !== null) return true;
  return appConfigDiskValue(name, env, keys.apiUrlKeys) !== null;
}

/**
 * The resolved HTTP storage client plus the decision that produced it.
 *
 * There is no `local` branch here on purpose: a client never infers a local
 * dataset from missing configuration. When nothing resolves, the shared
 * resolver THROWS and the caller decides (see src/store/index.ts).
 */
export interface ResolvedSecretsStorageClient {
  transport: "http";
  client: HasnaStorageClient;
  resolution: ClientTransportResolution;
}

/**
 * Resolve the authenticated secrets HTTP client for this environment.
 *
 * Throws `ClientTransportConfigurationError` when no credential resolves from
 * any tier, when a deliberate tier cannot be honoured, or when the configured
 * authorities disagree — never a quiet fall-through to local data.
 */
export function resolveSecretsStorageClient(
  name: string,
  env: Record<string, string | undefined> = process.env,
  options: SecretsClientResolutionOptions = {},
): ResolvedSecretsStorageClient {
  const wired = createClientTransport(name, env, {
    fetchImpl: guardedFetch,
    ...(options.credentials ? { credentials: options.credentials } : {}),
  });
  return {
    transport: "http",
    client: createHasnaStorageClient(name, wired.client),
    resolution: wired.resolution,
  };
}
