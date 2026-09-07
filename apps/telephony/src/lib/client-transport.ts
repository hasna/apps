/**
 * @hasna/telephony — client transport and credential resolution.
 *
 * ONE resolver, and it is not this file's own. Every hosted Hasna CLI resolves
 * its credential and its service authority through the client seam in
 * `@hasna/contracts` (owner directive 2026-09-04, hasna/apps#1720; fixed
 * forward by #1788 and #1794). This module is the thin telephony-shaped
 * adapter over it: it decides only what the shared resolver cannot know — that
 * telephony ALSO has an on-box SQLite store, and when serving from it is
 * legitimate.
 *
 * WHAT THIS REPLACED. Until this change the store resolver carried its own
 * chain: it read `HASNA_TELEPHONY_API_URL` / `HASNA_TELEPHONY_API_KEY` (and
 * the unprefixed aliases) straight out of `process.env`, rejected a partial
 * pair by hand, and only then handed the pair to `resolveStorageClient`. There
 * was no Keychain tier, no `~/.hasna/telephony/config/credentials` tier and no
 * default fleet gateway, so a station whose credential lived in the Keychain
 * or on disk failed closed while a station with the env pair worked. The
 * direct env reads are gone: the shared resolver reads every tier itself.
 *
 * THE CREDENTIAL LADDER (resolved fresh on every call, by the shared resolver):
 *   1. an explicit argument            — none surfaced by telephony today
 *   2. a deliberate env pointer        — HASNA_TELEPHONY_API_KEY_OVERRIDE,
 *                                        HASNA_PROFILE, HASNA_TELEPHONY_API_KEY_REF
 *   3. the macOS Keychain              — `hasna.credentials.telephony.api-key`,
 *                                        account HASNA_STATION -> `hostname -s` -> USER
 *   4. disk, read at call time         — ~/.hasna/telephony/config/credentials
 *                                        (0400/0600; HASNA_HOME / HASNA_CONFIG_HOME move it;
 *                                        XDG is never consulted)
 *   5. HASNA_TELEPHONY_API_KEY         — a legitimate tier, below disk, no notice
 *
 * THE AUTHORITY LADDER: HASNA_TELEPHONY_API_URL -> the Keychain `api-url` item
 * -> the credentials file -> the fleet gateway `https://api.hasna.com/telephony`
 * (the client appends `/v1`). A URL never needs configuring: a key from any
 * tier is enough to reach the fleet. The unprefixed `TELEPHONY_API_URL` /
 * `TELEPHONY_API_KEY` spellings remain only as the resolver's silent alias
 * fallback for one release; the canonical HASNA_-prefixed names always work
 * and always win.
 *
 * HOSTED MODE FAILS LOUD. When nothing resolves a credential the shared
 * resolver throws and this module rethrows an actionable fail-closed error —
 * non-zero exit, no SQLite, no local-fallback event. A configured authority
 * whose credential does not resolve is a HOSTED process with a broken
 * credential and always fails loud, never falling to the on-box store.
 *
 * LOCAL MODE IS DELIBERATE, NEVER A FALLBACK FROM FAILURE. The on-box SQLite
 * store is reachable only through the explicit opt-in `HASNA_TELEPHONY_LOCAL=1`
 * (alias `TELEPHONY_LOCAL=1`), and ONLY when nothing at all resolves: any
 * resolved credential — Keychain, disk, or env — outranks the opt-in and
 * selects the hosted API (secrets pattern; the opt-in yields). A local run
 * announces itself once per process on stderr: local is never a silent state.
 *
 * REMOVED, and never inputs again: the app's own env reads (the retired
 * fleet-env / cloud / XDG config locations, `~/.telephony/config.json`, the
 * `TELEPHONY_*` legacy names that used to outrank `HASNA_TELEPHONY_*`) and
 * every `*_MODE` / `*_STORAGE_MODE` switch with its DEPRECATED notice. Routing
 * follows what resolves, not a mode word.
 */
import {
  appConfigDiskValue,
  ClientTransportConfigurationError,
  clientTransportEnvKeys,
  createClientTransport,
  credentialDiskSources,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
  CREDENTIAL_PROFILE_ENV_KEY,
  defaultFleetGatewayBaseUrl,
  keychainConfigValue,
  type CredentialChainOptions,
  type CredentialTier,
  type KeychainTierOptions,
} from "@hasna/contracts/client";
import { createHasnaStorageClient, type HasnaStorageClient } from "@hasna/contracts/client/storage";

/** App name used for the canonical HASNA_TELEPHONY_* env contract. */
export const TELEPHONY_APP = "telephony";

const ENV_KEYS = clientTransportEnvKeys(TELEPHONY_APP);

/**
 * Canonical client variables. The unprefixed `TELEPHONY_API_URL` /
 * `TELEPHONY_API_KEY` spellings are the fleet-wide alias tier the shared
 * resolver accepts as a silent fallback; the canonical HASNA_-prefixed names
 * always work and always win.
 */
export const TELEPHONY_API_URL_ENV_KEYS = Object.freeze([...ENV_KEYS.apiUrlKeys]) as readonly string[];
export const TELEPHONY_API_KEY_ENV_KEYS = Object.freeze([...ENV_KEYS.apiKeyKeys]) as readonly string[];
export const TELEPHONY_API_URL_ENV = TELEPHONY_API_URL_ENV_KEYS[0]!;
export const TELEPHONY_API_KEY_ENV = TELEPHONY_API_KEY_ENV_KEYS[0]!;

/** `https://api.hasna.com/telephony` — the default authority; `/v1` is appended by the client. */
export const TELEPHONY_DEFAULT_API_URL = defaultFleetGatewayBaseUrl(TELEPHONY_APP);

/** Canonical explicit local-mode opt-in env var. */
export const TELEPHONY_LOCAL_MODE_ENV = "HASNA_TELEPHONY_LOCAL";
const LOCAL_MODE_OPT_IN_KEYS = [TELEPHONY_LOCAL_MODE_ENV, "TELEPHONY_LOCAL"] as const;

/**
 * True when the explicit local-mode opt-in is set to a truthy value
 * (`HASNA_TELEPHONY_LOCAL=1` or its `TELEPHONY_LOCAL` alias). `1`/`true`/`yes`
 * opt in; `0`/`false`/`no`/`off` and blank values all count as absent, so a
 * wrapper cannot flip local mode on by accident with a stale variable.
 *
 * The opt-in is a GATE, not a selector: it does not by itself choose the
 * LocalStore. Local mode applies only when the opt-in is set AND nothing at
 * all resolves a credential or an authority (see
 * {@link resolveTelephonyClientTransport}) — a resolved credential on the
 * machine always yields to the hosted API.
 */
export function isLocalModeOptIn(env: NodeJS.ProcessEnv = process.env): boolean {
  return LOCAL_MODE_OPT_IN_KEYS.some((key) => {
    const raw = env[key];
    if (raw === undefined) return false;
    const value = raw.trim().toLowerCase();
    return value !== "" && value !== "0" && value !== "false" && value !== "no" && value !== "off";
  });
}

/**
 * The fail-closed error raised when a store-backed surface runs without any
 * resolvable credential and without the explicit local opt-in. Actionable:
 * names the required variables and the opt-in, and never offers a silent
 * local fallback.
 */
export function telephonyStoreMisconfiguredError(): Error {
  return new Error(
    `No telephony API credential resolved and local mode is not enabled. ` +
      `The telephony client fails closed instead of silently serving the local SQLite store: ` +
      `set ${TELEPHONY_API_URL_ENV} and ${TELEPHONY_API_KEY_ENV} (unprefixed ` +
      `TELEPHONY_API_URL / TELEPHONY_API_KEY aliases are accepted) to route CLI, MCP and SDK ` +
      `data operations through the telephony HTTP API, or set ${TELEPHONY_LOCAL_MODE_ENV}=1 ` +
      `(alias TELEPHONY_LOCAL=1) to explicitly opt in to the on-box local store.`,
  );
}

/** Every env name that can configure a telephony authority or credential, resolver-derived. */
export function telephonyAuthorityEnvKeys(): string[] {
  return [
    ...TELEPHONY_API_URL_ENV_KEYS,
    ...TELEPHONY_API_KEY_ENV_KEYS,
    credentialOverrideEnvKey(TELEPHONY_APP),
    credentialPointerEnvKey(TELEPHONY_APP),
    CREDENTIAL_PROFILE_ENV_KEY,
  ];
}

/**
 * The environment as the resolver should see it: every authority/credential
 * variable that is DECLARED BUT BLANK removed.
 *
 * A blank has always been this package's spelling for "not configured".
 * @hasna/contracts takes the opposite and, for its purposes, correct view: a
 * declared-but-blank credential is a misconfiguration it refuses loudly rather
 * than resolving around. Normalising here keeps "blank means unset" true at
 * the telephony seam while leaving the resolver's stricter rule intact for
 * everything it does receive.
 */
export function telephonyNormalisedEnv<T extends Record<string, string | undefined>>(env: T): T {
  const blanks = telephonyAuthorityEnvKeys().filter((key) => key in env && (env[key] ?? "").trim() === "");
  if (blanks.length === 0) return env;
  const next = { ...env } as T;
  for (const key of blanks) delete next[key];
  return next;
}

/**
 * @hasna/contracts marks the LIVE process environment with this symbol so its
 * ambient tiers — the macOS Keychain `api-key` and `api-url` items, which
 * belong to the machine rather than to any env object — know they were handed
 * the real environment and not a caller-built one. It is a registry symbol
 * precisely so a normaliser like ours can read it without importing internals.
 */
const CONTRACTS_AMBIENT_ENVIRONMENT = Symbol.for("hasna:contracts:ambientClientEnvironment");

/** Is this the environment the machine's ambient credential stores belong to? */
function isAmbientEnv(env: Record<string, string | undefined>): boolean {
  if (typeof process !== "undefined" && (env as unknown) === (process.env as unknown)) return true;
  return (env as unknown as Record<symbol, unknown>)[CONTRACTS_AMBIENT_ENVIRONMENT] === true;
}

/** The env object and Keychain-tier policy a telephony surface hands @hasna/contracts. */
export interface TelephonyResolverInputs<T extends Record<string, string | undefined>> {
  env: T;
  keychain: KeychainTierOptions;
}

/**
 * Build the resolver's inputs: the normalised environment AND the credential
 * options that keep the machine's Keychain tier reachable across it.
 *
 * WHY THIS IS NOT JUST {@link telephonyNormalisedEnv}. Blanking a variable and
 * deleting it are not the same operation to @hasna/contracts, because dropping
 * a key forces us to hand the resolver a COPY, and the resolver gates its
 * ambient tiers on OBJECT IDENTITY (`env === process.env`, or its own snapshot
 * symbol). A copy is, by that test, a caller-built world, so the Keychain
 * would be outside it and the tier would turn itself off silently — dropping a
 * station from its Keychain identity to the next tier for the whole run
 * (hasna/apps#1788). The gate is decided HERE, on the original env, and
 * carried across the copy as the documented `keychain.enabled` control. An
 * explicit `enabled` or injected `run` from the caller still wins, so the
 * hermetic test seam is untouched.
 */
export function telephonyResolverInputs<T extends Record<string, string | undefined>>(
  env: T,
  options: { keychain?: KeychainTierOptions } = {},
): TelephonyResolverInputs<T> {
  const normalised = telephonyNormalisedEnv(env);
  if (normalised === env) return { env: normalised, keychain: options.keychain ?? {} };
  const keychain = { ...options.keychain };
  if (keychain.enabled === undefined && keychain.run === undefined) {
    keychain.enabled = isAmbientEnv(env);
  }
  return { env: normalised, keychain };
}

/**
 * The transport report a diagnostic reads: WHICH mode was selected and WHICH
 * tier decided it. Values are never included — only source names, presence
 * flags, and the credential-file candidates that would be consulted.
 */
export interface TelephonyClientTransportReport {
  mode: "http" | "local";
  /** `"local"` for the on-box store; otherwise the authority source (env key name, Keychain reference, path, or `"default"`). */
  transportSource: string;
  /** `<origin>/v1` base the hosted client targets; null in local mode. */
  baseUrl: string | null;
  apiUrlPresent: boolean;
  /** WHERE the authority came from (env key name, Keychain item, path), or `"default"`. Never a value. */
  apiUrlSource: string | null;
  apiKeyPresent: boolean;
  /** WHICH tier supplied the key (env key name, Keychain item, path). Never a value. */
  apiKeySource: string | null;
  apiKeyTier: CredentialTier | null;
  /** The credential files that would be consulted, in precedence order. */
  credentialFileCandidates: readonly string[];
  /** True when the Keychain tier is live for this process (darwin, ambient env). */
  keychainTierEnabled: boolean;
  warning: string | null;
}

/** Tier-3 controls (fake `security` runner in tests, or an explicit opt-out). */
export interface TelephonyClientTransportOptions {
  keychain?: KeychainTierOptions;
  /** Override fetch on the hosted transport (hermetic tests). */
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
}

let localModeAnnounced = false;

/** Test seam: forget that the local-mode line was printed. */
export function resetTelephonyLocalModeNotice(): void {
  localModeAnnounced = false;
}

/**
 * Announce the on-box store once per process, on stderr.
 *
 * Once, because the resolver is consulted many times per command and a banner
 * repeated per call is noise people learn to skip. On stderr, because JSON on
 * stdout stays parseable. Never silent: local is a legitimate mode for this
 * package, but an operator who believes they are on the fleet must be told
 * they are not.
 */
function announceLocalMode(env: Record<string, string | undefined>): void {
  if (localModeAnnounced) return;
  localModeAnnounced = true;
  const candidates = credentialDiskSources(TELEPHONY_APP, env);
  console.error(
    `telephony: LOCAL mode — no Hasna credential resolved, so CLI, MCP and SDK data operations use the ` +
      `on-box SQLite store. To go hosted, put the fleet key in the Keychain item ` +
      `hasna.credentials.${TELEPHONY_APP}.api-key${candidates[0] ? ` or in ${candidates[0]}` : ""}, ` +
      `or set ${TELEPHONY_API_KEY_ENV}${TELEPHONY_API_URL_ENV ? ` (with ${TELEPHONY_API_URL_ENV} to pin a non-default authority)` : ""}.`,
  );
}

/** The authority the ladder would use, or null when nothing configures one. */
function configuredAuthoritySource(
  env: Record<string, string | undefined>,
  keychain: KeychainTierOptions,
): string | null {
  const envKey = TELEPHONY_API_URL_ENV_KEYS.find(
    (key) => Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined,
  );
  if (envKey) return envKey;
  const keychainHit = keychainConfigValue(TELEPHONY_APP, env, keychain);
  if (keychainHit) return keychainHit.source;
  const diskHit = appConfigDiskValue(TELEPHONY_APP, env, TELEPHONY_API_URL_ENV_KEYS);
  return diskHit ? diskHit.path : null;
}

/** Whether tier 3 can actually run for this env/options pair. Diagnostics only. */
function keychainTierLive(
  env: Record<string, string | undefined>,
  options: KeychainTierOptions,
): boolean {
  if ((options.platform ?? process.platform) !== "darwin") return false;
  if (options.enabled !== undefined) return options.enabled;
  return options.run !== undefined || env === process.env;
}

export interface ResolvedTelephonyTransport {
  /** `"http"` when a credential resolved from any tier, `"local"` for the opted-in on-box store. */
  mode: "http" | "local";
  /** The authenticated storage client; null in local mode. */
  client: HasnaStorageClient | null;
  report: TelephonyClientTransportReport;
}

/**
 * Resolve the telephony Store's transport through the shared @hasna/contracts
 * resolver, FRESH on every call.
 *
 * HTTP when a credential resolves from any tier — the fleet gateway is the
 * authority unless one is configured. A configured authority with no
 * resolvable credential THROWS (hosted fails loud; there is no local
 * fallback). The on-box store only when the explicit
 * `HASNA_TELEPHONY_LOCAL=1` opt-in is set AND nothing at all resolves, and
 * then it says so once on stderr. Every other refusal — a blank variable, a
 * disagreeing pair, an unreadable credential file, a URL without a key — is a
 * misconfiguration the operator has to see, and is never resolved around.
 *
 * The credential itself is re-resolved by the transport per REQUEST (the
 * @hasna/contracts request binding), so a long-lived MCP server or SDK client
 * picks up a rotation without being rebuilt.
 */
export function resolveTelephonyClientTransport(
  env: NodeJS.ProcessEnv = process.env,
  options: TelephonyClientTransportOptions = {},
): ResolvedTelephonyTransport {
  const { env: resolverEnv, keychain } = telephonyResolverInputs(env, options);
  const base = {
    credentialFileCandidates: Object.freeze(credentialDiskSources(TELEPHONY_APP, resolverEnv)),
    keychainTierEnabled: keychainTierLive(resolverEnv, keychain),
    warning: null as string | null,
  };

  try {
    const credentials: CredentialChainOptions = { keychain };
    const wired = createClientTransport(TELEPHONY_APP, resolverEnv, {
      credentials,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    return {
      mode: "http",
      client: createHasnaStorageClient(TELEPHONY_APP, wired.client),
      report: {
        mode: "http",
        transportSource: wired.resolution.transportSource,
        baseUrl: wired.resolution.baseUrl,
        apiUrlPresent: wired.resolution.apiUrlSource !== null && wired.resolution.apiUrlSource !== "default",
        apiUrlSource: wired.resolution.apiUrlSource,
        apiKeyPresent: wired.resolution.apiKeyPresent,
        apiKeySource: wired.resolution.apiKeySource,
        apiKeyTier: wired.resolution.apiKeyTier,
        warning: wired.resolution.warning,
        credentialFileCandidates: base.credentialFileCandidates,
        keychainTierEnabled: base.keychainTierEnabled,
      },
    };
  } catch (error) {
    // A DELIBERATE tier that could not be honoured (a locked Keychain, a blank
    // override, a corrupt credentials file) is a CredentialResolutionError and
    // is never caught here: resolving around it would authenticate as, or
    // serve data as, somebody the operator did not name.
    if (!(error instanceof ClientTransportConfigurationError)) throw error;
    if (configuredAuthoritySource(resolverEnv, keychain)) throw error;
    // Nothing at all resolves. The on-box store is legitimate ONLY under the
    // explicit opt-in; otherwise telephony fails closed.
    if (isLocalModeOptIn(env)) {
      announceLocalMode(env);
      return {
        mode: "local",
        client: null,
        report: {
          mode: "local",
          transportSource: "local",
          baseUrl: null,
          apiUrlPresent: false,
          apiUrlSource: null,
          apiKeyPresent: false,
          apiKeySource: null,
          apiKeyTier: null,
          ...base,
        },
      };
    }
    throw telephonyStoreMisconfiguredError();
  }
}