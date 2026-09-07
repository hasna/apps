// The one seam between @hasna/domains and the shared Hasna client resolver.
//
// EVERY surface — the CLI, the MCP server, the `./sdk` and the store — answers
// "which key, from where, against which service" through the @hasna/contracts
// 1.0.2 client chain, resolved FRESH on every call. This package carries no
// chain of its own: the retired locations are never read and the retired
// switches never consulted (see `app-home.ts` / `db/store.ts`).
//
// THE TIERS the resolver applies, in order, FRESH ON EVERY CALL:
//   1. an explicit argument            — `apiKey` / `profile` passed in code
//   2. a deliberate env pointer        — HASNA_DOMAINS_API_KEY_OVERRIDE,
//                                        HASNA_PROFILE, HASNA_DOMAINS_API_KEY_REF
//   3. the macOS Keychain (darwin)     — `hasna.credentials.domains.api-key`,
//                                        account HASNA_STATION -> `hostname -s` -> USER
//   4. disk                            — ~/.hasna/domains/config/credentials
//                                        (HASNA_HOME / HASNA_CONFIG_HOME override;
//                                        XDG is never consulted)
//   5. HASNA_DOMAINS_API_KEY in the env — legitimate, no deprecation notice
//
// The authority follows the same ladder — HASNA_DOMAINS_API_URL, the Keychain
// `api-url` item, the credentials file — and DEFAULTS to the fleet gateway
// `https://api.hasna.com/domains` once a credential resolves (the client
// appends `/v1`). Retired locations (the fleet-env and cloud dirs under
// `~/.hasna`, `~/.config/hasna`, `$XDG_CONFIG_HOME`) are never read, and no
// `*_MODE` / `*_STORAGE_MODE` variable selects anything: the transport is
// decided by URL + key alone.
//
// THE BLANK-NORMALISATION GATE (#1788). A declared-but-blank authority
// variable is "not configured" at this package's seam, so it is dropped before
// the resolver sees it. Dropping a key forces a COPY of the environment, and
// @hasna/contracts gates its ambient tiers (the macOS Keychain) on OBJECT
// IDENTITY — a copy is a caller-built world and the Keychain tier silently
// turns itself off. The gate is therefore decided HERE, on the original env,
// and carried across the copy as the documented `keychain.enabled` control
// rather than being left to an identity test the copy cannot pass.
//
// WHAT THIS MODULE PUBLISHES. `@hasna/contracts` is a BUILD-TIME dependency:
// `bun build --target bun` inlines the resolver into every bundle, so the
// shipped bundles import node builtins only, and the declarations `tsc` emits
// must not import `@hasna/contracts` either (hasna/apps#1782). The contracts
// VALUES below are therefore imported for this package's own modules only (an
// import in a function body is erased from a declaration), while every TYPE
// that crosses the published boundary is spelled in ./client-types.ts and
// asserted identical by ./client-types.test.ts.

import {
  ClientTransportConfigurationError,
  completePointerCredential,
  createClientTransport,
  resolveClientTransport,
  resolveCredential,
} from "@hasna/contracts/client";
import { createHasnaStorageClient } from "@hasna/contracts/client/storage";
import type {
  ClientEnv,
  ClientTransportResolution,
  CredentialChainOptions,
  CredentialTier,
  HasnaStorageClient,
  ResolvedCredential,
} from "./client-types.js";
import { domainsAuthorityEnvKeys } from "./local-opt-in.js";

/** The app slug the shared client seam resolves credentials and authority for. */
export const DOMAINS_APP_NAME = "domains" as const;

export { domainsAuthorityEnvKeys } from "./local-opt-in.js";

/**
 * @hasna/contracts marks the LIVE process environment with this symbol so its
 * ambient tiers — the macOS Keychain `api-key` and `api-url` items, which
 * belong to the machine rather than to any env object — know they were handed
 * the real environment and not a caller-built one. It is a registry symbol
 * precisely so a normaliser like ours can read it without importing internals.
 */
const CONTRACTS_AMBIENT_ENVIRONMENT = Symbol.for("hasna:contracts:ambientClientEnvironment");

/**
 * Is this the environment the machine's ambient credential stores belong to?
 *
 * The same test @hasna/contracts performs, run on the env BEFORE we normalise
 * it — which is the whole point of asking here.
 */
function isAmbientEnv(env: ClientEnv): boolean {
  if (typeof process !== "undefined" && (env as unknown) === (process.env as unknown)) return true;
  return (env as unknown as Record<symbol, unknown>)[CONTRACTS_AMBIENT_ENVIRONMENT] === true;
}

/**
 * The environment as the resolver should see it: every authority/credential
 * variable that is DECLARED BUT BLANK removed.
 *
 * A blank has always been this package's spelling for "not configured" — it is
 * how fixtures scrub an inherited environment and how wrappers spell
 * `HASNA_DOMAINS_API_URL="${MAYBE_UNSET}"`. @hasna/contracts takes the
 * opposite and, for its purposes, correct view: a declared-but-blank credential
 * is a misconfiguration it refuses loudly rather than resolving around.
 *
 * Both are right at their own layer, and the mismatch is not hypothetical: an
 * environment carrying a real `HASNA_DOMAINS_API_KEY` alongside a blank legacy
 * alias — the exact shape a scrubbed-then-overridden fixture produces — is a
 * complete, unambiguous configuration that would otherwise be refused for the
 * alias nobody set. Normalising here keeps "blank means unset" true at the
 * domains seam while leaving the resolver's stricter rule intact for
 * everything it does receive: a value that is present is still policed, and
 * two aliases that actually disagree still refuse.
 */
export function domainsResolverEnv<T extends ClientEnv>(env: T): T {
  const blanks = domainsAuthorityEnvKeys().filter(
    (key) => key in env && (env[key] ?? "").trim() === "",
  );
  if (blanks.length === 0) return env;
  const next = { ...env } as T;
  for (const key of blanks) delete next[key];
  return next;
}

/** The env object and credential options a domains surface hands @hasna/contracts. */
export interface DomainsResolverInputs<T extends ClientEnv> {
  /** The environment with every declared-but-blank authority variable removed. */
  env: T;
  /** The chain options, with the Keychain tier's ambient gate already decided. */
  credentials: CredentialChainOptions;
}

/**
 * Build the resolver's inputs: the normalised environment AND the credential
 * options that keep the machine's Keychain tier reachable across it. See the
 * module header for why the gate has to travel with the copy.
 *
 * An explicit `enabled` from the caller still wins, and an injected `run`
 * (which @hasna/contracts already treats as "enabled") is left alone, so the
 * hermetic seam tests rely on is untouched. When there is no blank to remove
 * the inputs pass through by identity, exactly as before — the CLI hands the
 * resolver `process.env` itself, never a copy.
 */
export function domainsResolverInputs<T extends ClientEnv>(
  env: T,
  credentials: CredentialChainOptions = {},
): DomainsResolverInputs<T> {
  const normalised = domainsResolverEnv(env);
  if (normalised === env) return { env: normalised, credentials };
  const keychain = { ...credentials.keychain };
  if (keychain.enabled === undefined && keychain.run === undefined) {
    keychain.enabled = isAmbientEnv(env);
  }
  return { env: normalised, credentials: { ...credentials, keychain } };
}

/**
 * Options a domains surface forwards to the shared resolver: tier-1 credential
 * inputs and the Keychain-tier seam.
 */
export interface DomainsResolverOptions {
  /** Tier-1 credential inputs (`--api-key` / `--profile`) and Keychain controls. */
  credentials?: CredentialChainOptions;
}

/**
 * The transport report a caller can see — sources, tier, authority — with no
 * key value in it. `baseUrl` is the `<origin>/v1` base the resolver produced.
 */
export interface DomainsTransportReport {
  transport: "http";
  /** `<origin>/v1` base for the server API. */
  baseUrl: string;
  /** WHERE the API URL came from: env key NAME, Keychain reference, file PATH, or `"default"`. */
  apiUrlSource: string;
  /** WHERE the API key came from: env key NAME, Keychain reference, or file PATH. Never a value. */
  apiKeySource: string;
  /** Which tier of the credential chain supplied the key. */
  apiKeyTier: CredentialTier;
}

/**
 * Resolve the domains authority and credential through the shared chain,
 * FRESH, and return both the report and the credential VALUE.
 *
 * Throws a fail-closed `Error` (prefixed `domains fails closed: …`) that names
 * the canonical env pair when no credential resolves from any tier, when a
 * deliberate tier cannot be honoured, or when the configured authorities
 * disagree — never a quiet fall-through to local data.
 */
export function resolveDomainsTransport(
  env: ClientEnv = process.env,
  options: DomainsResolverOptions = {},
): { report: DomainsTransportReport; credential: ResolvedCredential } {
  const inputs = domainsResolverInputs(env, options.credentials ?? {});
  return resolveDomainsTransportWithInputs(inputs.env, inputs.credentials);
}

function resolveDomainsTransportWithInputs(
  env: ClientEnv,
  credentials: CredentialChainOptions,
): { report: DomainsTransportReport; credential: ResolvedCredential } {
  try {
    const resolution = resolveClientTransport(DOMAINS_APP_NAME, env, { credentials });
    const credential = resolveCredential(DOMAINS_APP_NAME, env, credentials);
    if (!credential) {
      // Unreachable: resolveClientTransport throws first. Kept so a future
      // resolver change cannot turn a missing credential into an anonymous client.
      throw new Error(
        `domains: no API key resolved from any credential tier; refusing to build an unauthenticated client.`,
      );
    }
    return {
      report: {
        transport: "http",
        baseUrl: resolution.baseUrl,
        apiUrlSource: resolution.apiUrlSource ?? "default",
        apiKeySource: credential.source,
        apiKeyTier: credential.tier,
      },
      credential,
    };
  } catch (error) {
    if (error instanceof ClientTransportConfigurationError) {
      // Fail closed, loudly, with the canonical names an operator must act on.
      // The resolver's message already names every tier it consulted.
      throw new Error(`domains fails closed: ${error.message}`);
    }
    throw error;
  }
}

/** A resolved HTTP storage client plus the decision that produced it. */
export interface ResolvedDomainsHttpClient {
  transport: "http";
  client: HasnaStorageClient;
  resolution: ClientTransportResolution;
}

/**
 * Resolve the authenticated domains HTTP client for this environment.
 *
 * The returned client resolves its credential FRESH on every request (the
 * transport's per-request binding provider), so a key rotation heals a
 * long-lived MCP server or daemon without a rebuild. Throws a fail-closed
 * `Error` when no credential resolves from any tier — never a quiet
 * fall-through to local data.
 */
export function resolveDomainsHttpClient(
  env: ClientEnv = process.env,
  options: DomainsResolverOptions = {},
): ResolvedDomainsHttpClient {
  const inputs = domainsResolverInputs(env, options.credentials ?? {});
  try {
    const wired = createClientTransport(DOMAINS_APP_NAME, inputs.env, {
      ...(Object.keys(inputs.credentials).length > 0 ? { credentials: inputs.credentials } : {}),
    });
    return {
      transport: "http",
      client: createHasnaStorageClient(DOMAINS_APP_NAME, wired.client),
      resolution: wired.resolution,
    };
  } catch (error) {
    if (error instanceof ClientTransportConfigurationError) {
      throw new Error(`domains fails closed: ${error.message}`);
    }
    throw error;
  }
}