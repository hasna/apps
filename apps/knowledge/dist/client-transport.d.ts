export declare const KNOWLEDGE_APP_SLUG = "knowledge";
export declare const KNOWLEDGE_API_URL_ENV = "HASNA_KNOWLEDGE_API_URL";
export declare const KNOWLEDGE_API_KEY_ENV = "HASNA_KNOWLEDGE_API_KEY";
export declare const KNOWLEDGE_DATABASE_URL_ENV = "HASNA_KNOWLEDGE_DATABASE_URL";
/**
 * Explicit on-box opt-in. Set this (any non-empty value; the canonical value
 * is `1`) to serve the on-box SQLite/JSON stores WITHOUT the hosted API env.
 * It authorizes the missing-URL branch only: when HASNA_KNOWLEDGE_API_URL and
 * HASNA_KNOWLEDGE_API_KEY are both present the HTTP API is selected and this
 * variable is not consulted — a set of live credentials is never downgraded
 * to local by a stray opt-in (that silent downgrade is the failure class this
 * module exists to close).
 */
export declare const KNOWLEDGE_LOCAL_ENV = "HASNA_KNOWLEDGE_LOCAL";
/** Canonical client variables. Compatibility aliases are intentionally absent. */
export declare const KNOWLEDGE_API_URL_ENV_KEYS: readonly ["HASNA_KNOWLEDGE_API_URL"];
export declare const KNOWLEDGE_API_KEY_ENV_KEYS: readonly ["HASNA_KNOWLEDGE_API_KEY"];
/**
 * Removed selector names. They remain here only as a fail-loud ratchet so a
 * stale station fragment cannot be silently ignored.
 */
export declare const RETIRED_KNOWLEDGE_SELECTOR_ENV_KEYS: readonly ["HASNA_KNOWLEDGE_STORAGE_MODE", "HASNA_KNOWLEDGE_MODE", "KNOWLEDGE_STORAGE_MODE", "KNOWLEDGE_MODE"];
export type KnowledgeClientTransport = 'sqlite' | 'http';
export interface KnowledgeClientTransportReport {
    transport: KnowledgeClientTransport;
    /** The env key that selected the transport (never a value, never 'default'). */
    source: typeof KNOWLEDGE_API_URL_ENV | typeof KNOWLEDGE_LOCAL_ENV;
    api_url_present: boolean;
    api_key_present: boolean;
    local_opt_in_present: boolean;
    network_guard_active: boolean;
}
export declare class RetiredKnowledgeStorageSelectorError extends Error {
    readonly envKey: string;
    readonly code = "retired_knowledge_storage_selector";
    constructor(envKey: string);
}
/** Reject stale selector variables even when their value is blank. */
export declare function assertNoRetiredKnowledgeStorageSelector(env?: NodeJS.ProcessEnv): void;
/**
 * Resolve the client connection from canonical environment variables only.
 *
 * Fail-closed by default (owner directive 2026-09-04): with NO hosted API
 * config and NO explicit on-box opt-in the resolver throws an actionable
 * error instead of silently serving the on-box store at rc=0. That silent
 * default was incident 715712 — a harness session-env re-provision dropped
 * HASNA_KNOWLEDGE_API_URL + HASNA_KNOWLEDGE_API_KEY and the CLI served the
 * local store at exit 0, so items appeared gone. The old mitigation (one
 * stderr `knowledge-local-fallback` notice at exit 0) is gone with it: a
 * notice-and-continue is still a false green to anything checking the exit
 * code. On-box reads and writes now require HASNA_KNOWLEDGE_LOCAL=1 (or the
 * CLI's explicit `--store` override, which pins the on-box transport before
 * this resolver is consulted).
 *
 * Precedence: the API URL + key pair selects HTTP even when
 * HASNA_KNOWLEDGE_LOCAL is also set — the local opt-in authorizes the
 * missing-URL branch only and never downgrades live credentials to local.
 * An API URL without its credential fails closed. Values are never included
 * in the report or in errors.
 */
export declare function resolveKnowledgeClientTransport(env?: NodeJS.ProcessEnv): KnowledgeClientTransportReport;
