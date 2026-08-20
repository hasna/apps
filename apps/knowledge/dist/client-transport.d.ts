export declare const KNOWLEDGE_APP_SLUG = "knowledge";
export declare const KNOWLEDGE_API_URL_ENV = "HASNA_KNOWLEDGE_API_URL";
export declare const KNOWLEDGE_API_KEY_ENV = "HASNA_KNOWLEDGE_API_KEY";
export declare const KNOWLEDGE_DATABASE_URL_ENV = "HASNA_KNOWLEDGE_DATABASE_URL";
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
    source: typeof KNOWLEDGE_API_URL_ENV | 'default';
    api_url_present: boolean;
    api_key_present: boolean;
    network_guard_active: boolean;
}
export declare class RetiredKnowledgeStorageSelectorError extends Error {
    readonly envKey: string;
    readonly code = "retired_knowledge_storage_selector";
    constructor(envKey: string);
}
/** Reject stale selector variables even when their value is blank. */
export declare function assertNoRetiredKnowledgeStorageSelector(env?: NodeJS.ProcessEnv): void;
/** Test hook: re-arm the once-only local-fallback notice. */
export declare function resetKnowledgeLocalFallbackNotice(): void;
/**
 * Resolve the client connection from canonical environment variables only.
 * An API URL without its credential fails closed instead of drifting to the
 * on-box store. Values are never included in the report or in errors.
 */
export declare function resolveKnowledgeClientTransport(env?: NodeJS.ProcessEnv): KnowledgeClientTransportReport;
