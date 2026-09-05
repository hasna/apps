/**
 * @hasna/knowledge — client transport and credential selection.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * ONE resolver, and it is not this file's own. Every hosted Hasna CLI resolves
 * its credential and its service authority through the client seam in
 * `@hasna/contracts/client` (owner rulings 2026-09-04; hasna/apps#1720, #1668,
 * #1690). This module is the thin knowledge-shaped adapter over it: it decides
 * only what the shared resolver cannot know — that knowledge ALSO has an
 * on-box store, and when serving from it is legitimate.
 *
 * THE CREDENTIAL LADDER (resolved fresh on every call, by the shared resolver):
 *   1. an explicit argument            — `--api-key` / `--profile`
 *   2. a deliberate env pointer        — HASNA_KNOWLEDGE_API_KEY_OVERRIDE,
 *                                        HASNA_PROFILE, HASNA_KNOWLEDGE_API_KEY_REF
 *   3. the macOS Keychain              — `hasna.credentials.knowledge.api-key`,
 *                                        account HASNA_STATION -> `hostname -s` -> USER
 *   4. disk, read at call time         — ~/.hasna/knowledge/config/credentials
 *                                        (0400/0600; HASNA_HOME / HASNA_CONFIG_HOME move it)
 *   5. HASNA_KNOWLEDGE_API_KEY         — a legitimate tier, below disk, no notice
 *
 * THE AUTHORITY LADDER: HASNA_KNOWLEDGE_API_URL -> the Keychain `api-url` item
 * -> the credentials file -> the fleet gateway `https://api.hasna.com/knowledge`
 * (the client appends `/v1`). A URL never needs configuring: a key from any
 * tier is enough to reach the fleet.
 *
 * HOSTED MODE FAILS LOUD. When an authority is configured but no credential
 * resolves, this module rethrows the shared resolver's error and the caller
 * exits non-zero. There is NO silent drop onto the on-box SQLite/JSON store —
 * that false green is incident 715712, where a dropped session env made a
 * hosted station serve a stale local dataset at exit 0 and items appeared gone.
 *
 * LOCAL MODE IS STILL REAL, and knowledge is one of the few apps where it is:
 * the OSS package is a local knowledge base with its own SQLite/JSON store and
 * an explicit `--store` override. It is selected ONLY when nothing at all
 * resolves — no URL from any tier and no credential from any tier — and it
 * announces itself once, on stderr, so "local" is never a silent state.
 *
 * REMOVED, and never inputs again: HASNA_KNOWLEDGE_LOCAL (a mode switch;
 * routing follows the credential chain now), the *_MODE / *_STORAGE_MODE
 * selectors, and every ~/.hasna/fleet-env, ~/.hasna/cloud, ~/.config/hasna
 * location — the shared resolver refuses those paths on the app's behalf.
 */
import {
  appConfigDiskValue,
  ClientTransportConfigurationError,
  clientTransportEnvKeys,
  credentialDiskSources,
  defaultFleetGatewayBaseUrl,
  keychainConfigValue,
  resolveClientTransport,
  type CredentialChainOptions,
  type CredentialTier,
  type KeychainTierOptions,
} from '@hasna/contracts/client';
import { isNetworkGuardActive } from './net-guard.js';

export const KNOWLEDGE_APP_SLUG = 'knowledge';

const ENV_KEYS = clientTransportEnvKeys(KNOWLEDGE_APP_SLUG);

/**
 * Canonical client variables. The unprefixed `KNOWLEDGE_API_URL` /
 * `KNOWLEDGE_API_KEY` spellings are the fleet-wide alias tier the shared
 * resolver accepts as a silent fallback (manifest `aliasEnvPrefix`); the
 * canonical HASNA_-prefixed names always work and always win.
 */
export const KNOWLEDGE_API_URL_ENV_KEYS = Object.freeze([...ENV_KEYS.apiUrlKeys]) as readonly string[];
export const KNOWLEDGE_API_KEY_ENV_KEYS = Object.freeze([...ENV_KEYS.apiKeyKeys]) as readonly string[];
export const KNOWLEDGE_API_URL_ENV = KNOWLEDGE_API_URL_ENV_KEYS[0]!;
export const KNOWLEDGE_API_KEY_ENV = KNOWLEDGE_API_KEY_ENV_KEYS[0]!;
export const KNOWLEDGE_DATABASE_URL_ENV = 'HASNA_KNOWLEDGE_DATABASE_URL';

/** `https://api.hasna.com/knowledge` — the default authority; `/v1` is appended by the client. */
export const KNOWLEDGE_DEFAULT_API_URL = defaultFleetGatewayBaseUrl(KNOWLEDGE_APP_SLUG);

/**
 * Removed selector names. They remain here only as a fail-loud ratchet so a
 * stale station fragment cannot be silently ignored: a process that still
 * exports one of these was configured for a routing model that no longer
 * exists, and continuing under the new one would be a guess about intent.
 */
export const RETIRED_KNOWLEDGE_SELECTOR_ENV_KEYS = [
  'HASNA_KNOWLEDGE_STORAGE_MODE',
  'HASNA_KNOWLEDGE_MODE',
  'KNOWLEDGE_STORAGE_MODE',
  'KNOWLEDGE_MODE',
] as const;

/**
 * The retired on-box opt-in.
 *
 * It is ACCEPTED and IGNORED for one release rather than rejected: it could
 * only ever have selected the on-box store, which is now exactly what happens
 * when nothing resolves, so a station fragment that still exports it lands on
 * the same transport it asked for. `knowledge transport` names it as ignored.
 * It is deleted in the next minor.
 */
export const RETIRED_KNOWLEDGE_LOCAL_ENV = 'HASNA_KNOWLEDGE_LOCAL';

export type KnowledgeClientTransport = 'sqlite' | 'http';

export interface KnowledgeClientTransportReport {
  transport: KnowledgeClientTransport;
  /**
   * WHAT selected the transport, never a value: an env key NAME, a Keychain
   * item reference (`keychain:<service>@<account>`), the absolute PATH of the
   * credentials file, `'default'` (the fleet gateway), or `'local'` (nothing
   * resolved, so the on-box store applies).
   */
  source: string;
  /** `<origin>/v1` base the client targets; null on the on-box store. */
  base_url: string | null;
  /** True when an authority was CONFIGURED (env, Keychain, or file) rather than defaulted. */
  api_url_present: boolean;
  /** WHERE the authority came from (env key name, Keychain item, path, 'default'), or null. */
  api_url_source: string | null;
  api_key_present: boolean;
  /** WHICH tier supplied the key (env key name, Keychain item, path), or null. Never a value. */
  api_key_source: string | null;
  api_key_tier: CredentialTier | null;
  /** The credential files that would be consulted, in precedence order. */
  credential_file_candidates: readonly string[];
  /** True when the Keychain tier is live for this process (darwin, ambient env, guard off). */
  keychain_tier_enabled: boolean;
  /** True when the retired HASNA_KNOWLEDGE_LOCAL is set; it is ignored. */
  legacy_local_opt_in_present: boolean;
  network_guard_active: boolean;
  /** Advisory from the shared resolver (e.g. a store-decided authority). Never a value. */
  warning: string | null;
}

/** Tier-1 inputs and Keychain-tier controls, forwarded to the shared resolver. */
export interface KnowledgeClientTransportOptions {
  /** Tier 1: an explicit key, e.g. from `--api-key`. */
  apiKey?: string;
  /** Tier 1: an explicit profile name, e.g. from `--profile`. */
  profile?: string;
  /** Tier 3 controls: a fake `security` runner in tests, or an explicit opt-out. */
  keychain?: KeychainTierOptions;
}

export class RetiredKnowledgeStorageSelectorError extends Error {
  readonly code = 'retired_knowledge_storage_selector';

  constructor(readonly envKey: string) {
    super(
      `knowledge: ${envKey} was retired and must be unset. `
        + `Clients resolve their credential through @hasna/contracts — an explicit --api-key, `
        + `${KNOWLEDGE_API_KEY_ENV}_OVERRIDE / HASNA_PROFILE / ${KNOWLEDGE_API_KEY_ENV}_REF, the macOS Keychain `
        + `item hasna.credentials.${KNOWLEDGE_APP_SLUG}.api-key, ~/.hasna/${KNOWLEDGE_APP_SLUG}/config/credentials, `
        + `then ${KNOWLEDGE_API_KEY_ENV} — and reach ${KNOWLEDGE_DEFAULT_API_URL} unless ${KNOWLEDGE_API_URL_ENV} `
        + `(or the Keychain api-url item, or the credentials file) names another authority. `
        + `With no credential and no authority anywhere, the on-box store applies. `
        + `Servers select PostgreSQL with ${KNOWLEDGE_DATABASE_URL_ENV}.`,
    );
    this.name = 'RetiredKnowledgeStorageSelectorError';
  }
}

function firstDefined(env: NodeJS.ProcessEnv, keys: readonly string[]): string | null {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined) return key;
  }
  return null;
}

/** Reject stale selector variables even when their value is blank. */
export function assertNoRetiredKnowledgeStorageSelector(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const retired = firstDefined(env, RETIRED_KNOWLEDGE_SELECTOR_ENV_KEYS);
  if (retired) throw new RetiredKnowledgeStorageSelectorError(retired);
}

/**
 * The Keychain-tier policy for this process.
 *
 * The tier is ambient by default — it runs for the live `process.env` and not
 * for a caller-built env. On top of that it is turned OFF while the outbound
 * network guard is armed (`NODE_ENV=test`): a test process must never adopt
 * the developer's station credential and flip the suite onto the live fleet,
 * and the guard already draws exactly that line for egress.
 */
export function knowledgeKeychainTierOptions(
  env: NodeJS.ProcessEnv = process.env,
): KeychainTierOptions {
  return isNetworkGuardActive(env) ? { enabled: false } : {};
}

function credentialOptions(
  env: NodeJS.ProcessEnv,
  options: KnowledgeClientTransportOptions,
): CredentialChainOptions {
  return {
    ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
    ...(options.profile !== undefined ? { profile: options.profile } : {}),
    keychain: options.keychain ?? knowledgeKeychainTierOptions(env),
  };
}

/**
 * The authority the ladder would use, or null when nothing configures one.
 *
 * Read separately from {@link resolveClientTransport} for ONE decision: when
 * that resolver refuses for want of a credential, this answers whether an
 * authority was nevertheless configured. Configured authority + no credential
 * is a hosted process with a broken credential and must fail loudly; nothing
 * configured anywhere is an unhosted install, and knowledge has a local store
 * for exactly that case.
 */
function configuredAuthoritySource(
  env: NodeJS.ProcessEnv,
  keychain: KeychainTierOptions,
): string | null {
  const envKey = ENV_KEYS.apiUrlKeys.find(
    (key) => Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined,
  );
  if (envKey) return envKey;
  const keychainHit = keychainConfigValue(KNOWLEDGE_APP_SLUG, env, keychain);
  if (keychainHit) return keychainHit.source;
  const diskHit = appConfigDiskValue(KNOWLEDGE_APP_SLUG, env, ENV_KEYS.apiUrlKeys);
  return diskHit ? diskHit.path : null;
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
let localModeAnnounced = false;
let legacyOptInAnnounced = false;

/** Test seam: forget that the local-mode and retirement lines were printed. */
export function resetKnowledgeLocalModeNotice(): void {
  localModeAnnounced = false;
  legacyOptInAnnounced = false;
}

/**
 * Name the retired opt-in once, on stderr, when a process still sets it.
 *
 * Silently ignoring it would leave an operator believing a switch still steers
 * routing that no longer does — the same failure the retired-selector ratchet
 * refuses loudly. This one is a notice rather than an error only because
 * ignoring it lands on the transport it asked for.
 */
function announceRetiredLocalOptIn(): void {
  if (legacyOptInAnnounced) return;
  legacyOptInAnnounced = true;
  console.error(
    `knowledge: ${RETIRED_KNOWLEDGE_LOCAL_ENV} is set and IGNORED (retired). Routing follows the credential `
      + `chain now: a credential from any tier selects the server API, and the on-box store applies when none `
      + `resolves. Unset it; it is deleted in the next minor.`,
  );
}

function announceLocalMode(env: NodeJS.ProcessEnv): void {
  if (localModeAnnounced) return;
  localModeAnnounced = true;
  const candidates = credentialDiskSources(KNOWLEDGE_APP_SLUG, env);
  console.error(
    `knowledge: no fleet credential resolved — using the on-box store (local mode). `
      + `To use the fleet, put the key in the Keychain item hasna.credentials.${KNOWLEDGE_APP_SLUG}.api-key`
      + `${candidates[0] ? ` or in ${candidates[0]}` : ''}, or set ${KNOWLEDGE_API_KEY_ENV}.`,
  );
}

/**
 * Resolve the client connection through the shared @hasna/contracts resolver.
 *
 * HTTP when a credential resolves from any tier — the fleet gateway is the
 * authority unless one is configured. A configured authority with no
 * resolvable credential THROWS (hosted fails loud; there is no local
 * fallback). The on-box store only when nothing resolves at all, and then it
 * says so once on stderr. Values are never included in the report or in
 * errors.
 */
export function resolveKnowledgeClientTransport(
  env: NodeJS.ProcessEnv = process.env,
  options: KnowledgeClientTransportOptions = {},
): KnowledgeClientTransportReport {
  assertNoRetiredKnowledgeStorageSelector(env);
  const keychain = options.keychain ?? knowledgeKeychainTierOptions(env);
  const legacyLocalOptIn = Object.prototype.hasOwnProperty.call(env, RETIRED_KNOWLEDGE_LOCAL_ENV)
    && env[RETIRED_KNOWLEDGE_LOCAL_ENV] !== undefined;
  if (legacyLocalOptIn) announceRetiredLocalOptIn();
  const base = {
    credential_file_candidates: Object.freeze(credentialDiskSources(KNOWLEDGE_APP_SLUG, env)),
    keychain_tier_enabled: keychainTierLive(env, keychain),
    legacy_local_opt_in_present: legacyLocalOptIn,
    network_guard_active: isNetworkGuardActive(env),
  };

  try {
    const resolution = resolveClientTransport(KNOWLEDGE_APP_SLUG, env, {
      credentials: credentialOptions(env, { ...options, keychain }),
    });
    return {
      transport: 'http',
      source: resolution.transportSource,
      base_url: resolution.baseUrl,
      api_url_present: resolution.apiUrlSource !== null && resolution.apiUrlSource !== 'default',
      api_url_source: resolution.apiUrlSource,
      api_key_present: resolution.apiKeyPresent,
      api_key_source: resolution.apiKeySource,
      api_key_tier: resolution.apiKeyTier,
      warning: resolution.warning,
      ...base,
    };
  } catch (error) {
    // A DELIBERATE tier that could not be honoured (a locked Keychain, a blank
    // override, a corrupt credentials file) is a CredentialResolutionError and
    // is never caught here: resolving around it would authenticate as, or
    // serve data as, somebody the operator did not name.
    if (!(error instanceof ClientTransportConfigurationError)) throw error;
    if (configuredAuthoritySource(env, keychain)) throw error;
    announceLocalMode(env);
    return {
      transport: 'sqlite',
      source: 'local',
      base_url: null,
      api_url_present: false,
      api_url_source: null,
      api_key_present: false,
      api_key_source: null,
      api_key_tier: null,
      warning: null,
      ...base,
    };
  }
}

/** Whether tier 3 can actually run for this env/options pair. Diagnostics only. */
function keychainTierLive(env: NodeJS.ProcessEnv, options: KeychainTierOptions): boolean {
  if ((options.platform ?? process.platform) !== 'darwin') return false;
  if (options.enabled !== undefined) return options.enabled;
  return options.run !== undefined || env === process.env;
}
