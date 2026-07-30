import { type StorageMode } from './generated/storage-kit/index.js';
/** App slug behind every `HASNA_KNOWLEDGE_*` / `KNOWLEDGE_*` env key. */
export declare const KNOWLEDGE_APP_SLUG = "knowledge";
/**
 * Mode env keys in precedence order, canonical first. Sourced from
 * @hasna/contracts rather than restated here: this list has to be the SAME list
 * the transport resolver consults, or a key we ignore could still flip the
 * transport underneath us.
 */
export declare const KNOWLEDGE_MODE_ENV_KEYS: readonly string[];
/** Pointer keys: where the cloud is. Never a mode selector. */
export declare const KNOWLEDGE_API_URL_ENV_KEYS: readonly string[];
/** Pointer keys: how to authenticate. Never a mode selector, never logged. */
export declare const KNOWLEDGE_API_KEY_ENV_KEYS: readonly string[];
/** `local` = on-box store. `cloud` = the app's HTTP `/v1` API. */
export type KnowledgeMode = StorageMode;
export interface KnowledgeModeSource {
    /** `env` when a mode var selected it, `default` when nothing did. */
    kind: 'env' | 'default';
    /** The env key that selected the mode, or null for the default. */
    name: string | null;
    /** The mode var's own value (`local` / `cloud` / a deprecated alias). Never a pointer value. */
    value: string | null;
}
export interface KnowledgeModeResolution {
    mode: KnowledgeMode;
    source: KnowledgeModeSource;
    /**
     * NAMES of pointer vars that are set. Names only, never values: one of these
     * holds an API key and another holds a URL, and this object is printed by the
     * `mode` reporter and embedded in error messages.
     */
    pointer_env_present: string[];
    /**
     * True when pointers are set but did NOT choose the backend. This is exactly
     * the configuration that used to flip silently, so it is reported rather than
     * inferred from the two other fields by every caller.
     */
    pointer_ignored: boolean;
    /** Operator-facing note naming the variable to change, or null. */
    warning: string | null;
}
/**
 * Resolve the mode for this process from an explicit setting alone.
 *
 * Precedence: the first mode key that carries a value wins and RETURNS — the
 * pointer keys are not even read on that path, which is what makes an explicit
 * `KNOWLEDGE_MODE=local` authoritative on a machine whose shell exports a URL
 * and a key. With no mode key set the answer is `local`, the safe default,
 * regardless of what pointers exist.
 *
 * Throws only on an unusable mode value (never on pointer state) so a typo in
 * the one variable that matters fails loudly instead of quietly reading the
 * wrong store.
 */
export declare function resolveKnowledgeModeSelection(env?: NodeJS.ProcessEnv): KnowledgeModeResolution;
/**
 * The env to hand @hasna/contracts, with the mode we resolved stamped on top.
 *
 * Load-bearing in BOTH directions. Stamping `cloud` keeps the transport from
 * refusing a mode we deliberately chose; stamping `local` is what stops
 * `resolveClientTransport` from re-deriving cloud out of the ambient pointer
 * vars we just decided to ignore. Handing it the raw environment instead would
 * put the backend choice back in a second layer.
 */
export declare function pinnedTransportEnv(env: NodeJS.ProcessEnv, mode: KnowledgeMode): NodeJS.ProcessEnv;
/**
 * Raised when the environment names a store but never says to use it.
 *
 * Carries a `code` so callers can branch on the condition without matching on
 * message text.
 */
export declare class HalfConfiguredKnowledgeClientError extends Error {
    readonly code = "knowledge_mode_unset_with_api_url";
    constructor(urlKeysPresent: readonly string[]);
}
/**
 * Gate a store-touching command on an UNAMBIGUOUS environment.
 *
 * Deliberately separate from {@link resolveKnowledgeModeSelection}, which stays
 * total and non-throwing. The resolver has to keep answering `local` in exactly
 * the environment this rejects, because `knowledge mode` — the command whose
 * whole job is explaining the situation — resolves through it. A guard fused
 * into the resolver would kill the diagnostic along with the defect.
 *
 * Fires on an API URL only, never on a key alone. A key with no URL points at
 * no store, so there is nothing to be ambiguous about; erroring there would
 * fire on machines that could never have routed anywhere, and a check that
 * cries wolf is a check somebody turns off.
 *
 * `storePathOverridden` (an explicit `--store <path>`) is an explicit local
 * choice and passes for the same reason `MODE=local` does: the operator said
 * which store they meant.
 */
export declare function assertKnowledgeModeSelected(env?: NodeJS.ProcessEnv, options?: {
    storePathOverridden?: boolean;
}): KnowledgeModeResolution;
export interface KnowledgeModeReport extends KnowledgeModeResolution {
    /** `local` -> the on-box store; `api` -> the HTTP `/v1` transport. */
    store_transport: 'local' | 'api';
    /** Whether an API key is available at all. Presence only — never the value. */
    api_key_present: boolean;
    /** Whether the outbound request guard is refusing non-loopback traffic. */
    network_guard_active: boolean;
}
/**
 * The payload behind `knowledge mode`. Deliberately derived from the
 * environment alone: no store open, no config file read, no request. An
 * operator on a machine that cannot reach the network still gets a truthful
 * answer about which backend this CLI would use, which is the thing that was
 * impossible to tell without reading source.
 */
export declare function knowledgeModeReport(env?: NodeJS.ProcessEnv): KnowledgeModeReport;
