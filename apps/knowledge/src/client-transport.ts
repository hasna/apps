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
 * HOSTED MODE FAILS LOUD. When no credential resolves, from ANY tier, this
 * module throws and the caller exits non-zero. There is NO drop onto the
 * on-box SQLite/JSON store — that false green is incident 715712, where a
 * dropped session env made a hosted station serve a stale local dataset at
 * exit 0 and items appeared gone.
 *
 * LOCAL MODE IS STILL REAL, and knowledge is one of the few apps where it is:
 * the OSS package is a local knowledge base with its own SQLite/JSON store and
 * an explicit `--store` override. It is reachable ONLY by the EXPLICIT
 * opt-in `HASNA_KNOWLEDGE_LOCAL=1` (or the explicit `--store` argument), and
 * it announces itself once on stderr — the word "local" is never silent.
 * The opt-in is answered BEFORE the shared resolver runs and without reading
 * the Keychain or any credentials file; an environment that CONFIGURES an
 * authority or credential outranks it, so a half-configured run still fails
 * loudly rather than quietly serving a different dataset because a stale
 * opt-in was lying around.
 *
 * REMOVED, and never inputs again: the retirement of `HASNA_KNOWLEDGE_LOCAL`
 * (it is the live opt-in now, not a retired switch), the *_MODE /
 * *_STORAGE_MODE selectors, and every ~/.hasna/fleet-env, ~/.hasna/cloud,
 * ~/.config/hasna location — the shared resolver refuses those paths on the
 * app's behalf. `~/.hasna/knowledge/auth.json` is no longer consulted by the
 * credential chain at all (see src/auth.ts).
 */
import {
  CREDENTIAL_PROFILE_ENV_KEY,
  clientTransportEnvKeys,
  credentialDiskSources,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
  defaultFleetGatewayBaseUrl,
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
 * The deliberate unhosted opt-in, canonical name first. Setting it (non-blank)
 * selects the on-box store whenever no authority or credential key is
 * configured in the environment; see {@link selectsKnowledgeLocalStore}.
 */
export const KNOWLEDGE_LOCAL_OPT_IN_ENV_KEYS = ['HASNA_KNOWLEDGE_LOCAL'] as const;
export const KNOWLEDGE_LOCAL_OPT_IN_ENV = KNOWLEDGE_LOCAL_OPT_IN_ENV_KEYS[0];

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

export type KnowledgeClientTransport = 'sqlite' | 'http';

export interface KnowledgeClientTransportReport {
  transport: KnowledgeClientTransport;
  /**
   * WHAT selected the transport, never a value: an env key NAME, a Keychain
   * item reference (`keychain:<service>@<account>`), the absolute PATH of the
   * credentials file, `'default'` (the fleet gateway), or `'local-opt-in'`
   * (the explicit on-box opt-in).
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
  /** True when the explicit local-mode opt-in `HASNA_KNOWLEDGE_LOCAL` is set (non-blank). */
  local_opt_in_present: boolean;
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
        + `With no credential and no ${KNOWLEDGE_LOCAL_OPT_IN_ENV} opt-in the client fails closed. `
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
 * `true` when the operator asked for the on-box store: `HASNA_KNOWLEDGE_LOCAL`
 * carries a non-blank own value. Own-property only, matching how the shared
 * resolver reads the environment: an inherited property cannot configure it.
 */
export function isKnowledgeLocalOptIn(env: NodeJS.ProcessEnv = process.env): boolean {
  return KNOWLEDGE_LOCAL_OPT_IN_ENV_KEYS.some((key) => envKeySet(env, key));
}

/**
 * Every env name that can configure a Knowledge authority or credential,
 * resolver-derived so the NAMES here are the resolver's own, not a copy that
 * can fall behind.
 */
export function knowledgeAuthorityEnvKeys(): string[] {
  const keys = clientTransportEnvKeys(KNOWLEDGE_APP_SLUG);
  return [
    ...keys.apiUrlKeys,
    ...keys.apiKeyKeys,
    credentialOverrideEnvKey(KNOWLEDGE_APP_SLUG),
    credentialPointerEnvKey(KNOWLEDGE_APP_SLUG),
    CREDENTIAL_PROFILE_ENV_KEY,
  ];
}

/** An own, non-blank variable on the env dictionary. */
function envKeySet(env: NodeJS.ProcessEnv, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(env, key) && (env[key] ?? '').trim() !== '';
}

/**
 * Does the ENVIRONMENT itself configure a Knowledge authority or credential?
 *
 * Deliberately narrower than "does a credential resolve": answering it must not
 * touch the Keychain or the filesystem, because doing so would defeat the
 * isolation the opt-in short-circuit exists to provide. It reads the env
 * dictionary and nothing else — and only OWN properties, exactly as the shared
 * resolver does.
 *
 * A DECLARED-BUT-BLANK variable counts as absent HERE — a blank has always been
 * this package's spelling for "not configured". It is NOT absent once we do go
 * hosted: the shared resolver refuses a blank loudly rather than falling
 * through to another identity, which is the behaviour that matters at that
 * point.
 */
export function hasKnowledgeEnvAuthorityIntent(env: NodeJS.ProcessEnv = process.env): boolean {
  return knowledgeAuthorityEnvKeys().some((key) => envKeySet(env, key));
}

/**
 * True when this environment should be served by the on-box store: nothing
 * configures an authority or credential in the ENV, and the operator set the
 * explicit opt-in. A machine Keychain or credentials file never counts as
 * intent here — the opt-in is answered without the resolver, so those stores
 * are not read at all for the decision.
 */
export function selectsKnowledgeLocalStore(env: NodeJS.ProcessEnv = process.env): boolean {
  return !hasKnowledgeEnvAuthorityIntent(env) && isKnowledgeLocalOptIn(env);
}

/**
 * Announce the on-box store once per process, on stderr.
 *
 * Once, because the resolver is consulted many times per command and a banner
 * repeated per call is noise people learn to skip. On stderr, because JSON on
 * stdout stays parseable. Never silent, and never implicit: local mode exists
 * ONLY when the operator opted into it, and an operator who believes they are
 * on the fleet must be told they are not.
 */
let localModeAnnounced = false;

/** Test seam: forget that the local-mode line was printed. */
export function resetKnowledgeLocalModeNotice(): void {
  localModeAnnounced = false;
}

function announceLocalMode(env: NodeJS.ProcessEnv): void {
  if (localModeAnnounced) return;
  localModeAnnounced = true;
  const candidates = credentialDiskSources(KNOWLEDGE_APP_SLUG, env);
  console.error(
    `knowledge: local mode — the explicit ${KNOWLEDGE_LOCAL_OPT_IN_ENV} opt-in selected the on-box store. `
      + `To use the fleet instead, put the key in the Keychain item hasna.credentials.${KNOWLEDGE_APP_SLUG}.api-key`
      + `${candidates[0] ? ` or in ${candidates[0]}` : ''}, or set ${KNOWLEDGE_API_KEY_ENV}, `
      + `and unset ${KNOWLEDGE_LOCAL_OPT_IN_ENV}.`,
  );
}

/** The fail-closed diagnostic every unresolved transport reports. Never a credential value. */
export function knowledgeFailClosedMessage(original: string): string {
  return `knowledge: client credential resolution failed — ${original} `
    + `There is no local fallback: the on-box store is opt-in only (${KNOWLEDGE_LOCAL_OPT_IN_ENV}=1) `
    + 'and disabled by default — failing closed instead of serving local data.';
}

/**
 * Resolve the client connection through the shared @hasna/contracts resolver.
 *
 * HTTP when a credential resolves from any tier — the fleet gateway is the
 * authority unless one is configured. Local mode is reachable ONLY through the
 * explicit opt-in (`HASNA_KNOWLEDGE_LOCAL=1`), which is answered BEFORE the
 * resolver runs and without reading the Keychain or any credentials file; it
 * says "local" once on stderr. Every other failure — no credential anywhere, a
 * configured authority with no resolvable credential, a deliberate tier that
 * cannot be honoured — THROWS and the caller exits non-zero: there is no
 * on-box fallback, no sqlite touch and no *-local-fallback event. Values are
 * never included in the report or in errors.
 */
export function resolveKnowledgeClientTransport(
  env: NodeJS.ProcessEnv = process.env,
  options: KnowledgeClientTransportOptions = {},
): KnowledgeClientTransportReport {
  assertNoRetiredKnowledgeStorageSelector(env);
  const keychain = options.keychain ?? knowledgeKeychainTierOptions(env);
  const localOptIn = isKnowledgeLocalOptIn(env);
  const base = {
    credential_file_candidates: Object.freeze(credentialDiskSources(KNOWLEDGE_APP_SLUG, env)),
    keychain_tier_enabled: keychainTierLive(env, keychain),
    local_opt_in_present: localOptIn,
    network_guard_active: isNetworkGuardActive(env),
  };

  if (selectsKnowledgeLocalStore(env)) {
    announceLocalMode(env);
    return {
      transport: 'sqlite',
      source: 'local-opt-in',
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
    // FAIL CLOSED. A deliberate tier that could not be honoured (a locked
    // Keychain, a blank override, a corrupt credentials file) and a hosted
    // process with no credential at all are the same answer here: exit
    // non-zero, no SQLite, no local-fallback event. The opt-in was already
    // answered above, so there is nothing left to fall back to.
    throw new Error(knowledgeFailClosedMessage(error instanceof Error ? error.message : String(error)), {
      cause: error,
    });
  }
}

/** Whether tier 3 can actually run for this env/options pair. Diagnostics only. */
function keychainTierLive(env: NodeJS.ProcessEnv, options: KeychainTierOptions): boolean {
  if ((options.platform ?? process.platform) !== 'darwin') return false;
  if (options.enabled !== undefined) return options.enabled;
  return options.run !== undefined || env === process.env;
}