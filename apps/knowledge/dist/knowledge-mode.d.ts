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
 * Server-side tokens, in probe order. The order is load-bearing, and it is
 * NEWEST-GENERATION FIRST, THEN CANONICAL BEFORE DEPRECATED:
 *
 *   postgres     the current canonical server token
 *   cloud        the previous canonical server token
 *   self_hosted  a DEPRECATED alias of `cloud`, last resort only
 *
 * Both halves matter. Newest-first is what stops a transitional contracts
 * release — one that still honours the old words — from pinning us to the old
 * generation. Canonical-before-deprecated is what stops us pinning
 * `self_hosted` on the enum where `cloud` is the real answer: both are accepted
 * there, but only one is the token this package already injects, and switching
 * to the alias would be a live behaviour change dressed up as a refactor.
 *
 * (Sibling repos list `self_hosted` ahead of `cloud` for exactly the same
 * reason inverted — `self_hosted` is the literal THEY replace. The rule is
 * "derive what this repo already injects on the installed generation", not
 * "copy the other repo's array".)
 */
export declare const SERVER_MODE_CANDIDATES: readonly ['postgres', 'cloud', 'self_hosted'];
/** On-box tokens, same rule: newest generation first. */
export declare const LOCAL_MODE_CANDIDATES: readonly ['sqlite', 'local'];
/** Accepts a mode token or throws. Injectable so both enum generations are testable. */
export type ModeNormalizer = (value: string) => unknown;
/** The live-contracts token meaning "the app server". */
export declare function serverStorageMode(normalize?: ModeNormalizer): string;
/** The live-contracts token meaning "the on-box store". */
export declare function localStorageMode(normalize?: ModeNormalizer): string;
/**
 * Translate OUR semantic mode into the token the INSTALLED @hasna/contracts
 * accepts.
 *
 * THIS FUNCTION IS A TRANSLATION, NOT A PASS-THROUGH, AND THAT IS THE WHOLE
 * POINT — do not "simplify" it back. This module holds two independent
 * validators, and they are allowed to disagree:
 *
 *   - {@link normalizeVendoredMode}, from the vendored `src/generated/storage-kit`,
 *     validates what an OPERATOR typed. Its vocabulary is `local | cloud` and
 *     that is the vocabulary in the docs, the `knowledge mode` report, and the
 *     env vars people set. {@link KnowledgeMode} is that type.
 *   - the LIVE `@hasna/contracts` validates the token we hand its resolver.
 *     After the placement axis was removed it accepts ONLY `sqlite | postgres`
 *     and THROWS on `local`/`cloud`.
 *
 * Post-removal those two sets are DISJOINT, which reads at first like an
 * impossible constraint: the token that satisfies the type is the token the
 * resolver rejects. It is not impossible, because they never had to be the same
 * value. {@link KnowledgeMode} types the INTERNAL semantic mode; what reaches
 * the resolver is an ENV STRING, and `NodeJS.ProcessEnv` values are
 * `string | undefined` — nothing ever forced the stamped token to satisfy the
 * vendored type. The two vocabularies meet in exactly one place, here, so
 * translating here keeps the vendored kit, the operator vocabulary, and the
 * explicit-only no-inference guarantee all untouched. Re-vendoring the kit is
 * NOT required to make this forward-compatible.
 *
 * The tokens are DERIVED by probing the installed `normalizeStorageMode` rather
 * than hardcoded, because a literal is a bet on which contracts generation a
 * given machine has, and the bet loses on one side or the other. `normalize` is
 * injectable because only one generation can be installed at a time, so
 * forward-compatibility would otherwise be an assertion rather than a test.
 *
 * BOUNDARY: the returned token is for the contracts resolver ONLY. Do not feed
 * a pinned env back into {@link resolveKnowledgeModeSelection} — that validates
 * with the VENDORED normalizer, which will reject the live token once the two
 * enums diverge.
 */
export declare function contractsStorageModeFor(mode: KnowledgeMode, normalize?: ModeNormalizer): string;
/**
 * The env to hand @hasna/contracts, with the mode we resolved stamped on top.
 *
 * Load-bearing in BOTH directions. Stamping the server token keeps the
 * transport from refusing a mode we deliberately chose; stamping the local
 * token is what stops `resolveClientTransport` from re-deriving the server out
 * of the ambient pointer vars we just decided to ignore. Handing it the raw
 * environment instead would put the backend choice back in a second layer.
 *
 * The stamped VALUE is the live-contracts token, not our `KnowledgeMode` — see
 * {@link contractsStorageModeFor} for why those are deliberately different
 * things.
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
