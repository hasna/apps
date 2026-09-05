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
import { type CredentialTier, type KeychainTierOptions } from '@hasna/contracts/client';
export declare const KNOWLEDGE_APP_SLUG = "knowledge";
/**
 * Canonical client variables. The unprefixed `KNOWLEDGE_API_URL` /
 * `KNOWLEDGE_API_KEY` spellings are the fleet-wide alias tier the shared
 * resolver accepts as a silent fallback (manifest `aliasEnvPrefix`); the
 * canonical HASNA_-prefixed names always work and always win.
 */
export declare const KNOWLEDGE_API_URL_ENV_KEYS: readonly string[];
export declare const KNOWLEDGE_API_KEY_ENV_KEYS: readonly string[];
export declare const KNOWLEDGE_API_URL_ENV: string;
export declare const KNOWLEDGE_API_KEY_ENV: string;
export declare const KNOWLEDGE_DATABASE_URL_ENV = "HASNA_KNOWLEDGE_DATABASE_URL";
/** `https://api.hasna.com/knowledge` — the default authority; `/v1` is appended by the client. */
export declare const KNOWLEDGE_DEFAULT_API_URL: string;
/**
 * Removed selector names. They remain here only as a fail-loud ratchet so a
 * stale station fragment cannot be silently ignored: a process that still
 * exports one of these was configured for a routing model that no longer
 * exists, and continuing under the new one would be a guess about intent.
 */
export declare const RETIRED_KNOWLEDGE_SELECTOR_ENV_KEYS: readonly ["HASNA_KNOWLEDGE_STORAGE_MODE", "HASNA_KNOWLEDGE_MODE", "KNOWLEDGE_STORAGE_MODE", "KNOWLEDGE_MODE"];
/**
 * The retired on-box opt-in.
 *
 * It is ACCEPTED and IGNORED for one release rather than rejected: it could
 * only ever have selected the on-box store, which is now exactly what happens
 * when nothing resolves, so a station fragment that still exports it lands on
 * the same transport it asked for. `knowledge transport` names it as ignored.
 * It is deleted in the next minor.
 */
export declare const RETIRED_KNOWLEDGE_LOCAL_ENV = "HASNA_KNOWLEDGE_LOCAL";
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
export declare class RetiredKnowledgeStorageSelectorError extends Error {
    readonly envKey: string;
    readonly code = "retired_knowledge_storage_selector";
    constructor(envKey: string);
}
/** Reject stale selector variables even when their value is blank. */
export declare function assertNoRetiredKnowledgeStorageSelector(env?: NodeJS.ProcessEnv): void;
/**
 * The Keychain-tier policy for this process.
 *
 * The tier is ambient by default — it runs for the live `process.env` and not
 * for a caller-built env. On top of that it is turned OFF while the outbound
 * network guard is armed (`NODE_ENV=test`): a test process must never adopt
 * the developer's station credential and flip the suite onto the live fleet,
 * and the guard already draws exactly that line for egress.
 */
export declare function knowledgeKeychainTierOptions(env?: NodeJS.ProcessEnv): KeychainTierOptions;
/** Test seam: forget that the local-mode and retirement lines were printed. */
export declare function resetKnowledgeLocalModeNotice(): void;
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
export declare function resolveKnowledgeClientTransport(env?: NodeJS.ProcessEnv, options?: KnowledgeClientTransportOptions): KnowledgeClientTransportReport;
