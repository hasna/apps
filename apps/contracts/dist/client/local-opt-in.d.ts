import { type Env } from "../env-token.js";
/** `HASNA_<APP>_LOCAL` — the canonical opt-in key for an app. */
export declare function localOptInEnvKey(name: string): string;
/**
 * `<APP>_LOCAL` — the unprefixed alias, accepted for ONE minor release (1.1.x)
 * because that spelling shipped in several apps; removed in 1.2.0.
 */
export declare function localOptInAliasEnvKey(name: string): string;
/** Values that turn the opt-in ON (case-insensitive, trimmed). */
export declare const LOCAL_OPT_IN_TRUE_VALUES: readonly ["1", "true", "yes"];
/** Values that leave it OFF (case-insensitive, trimmed); an unrecognised value is also OFF. */
export declare const LOCAL_OPT_IN_FALSE_VALUES: readonly ["", "0", "false", "no"];
export type LocalOptInState = "off" | "on" | "conflict";
export interface LocalOptInDescription {
    state: LocalOptInState;
    /** The canonical key, `HASNA_<APP>_LOCAL`. */
    envKey: string;
    /** Which key turned it on (the canonical key or the alias), or null when off. Never a value. */
    source: string | null;
    /** Hosted configuration keys declared alongside an ON flag. Empty unless `state === "conflict"`. */
    conflicts: string[];
    /** False when the flag is declared with a value outside the recognised sets (treated as OFF). */
    recognized: boolean;
}
/**
 * The hosted-client keys whose PRESENCE conflicts with the opt-in. Only the
 * process env is inspected — never the Keychain or a file — so the answer is
 * hermetic and costs no I/O.
 */
export declare function hostedClientEnvKeys(name: string): string[];
/**
 * Describe the opt-in without throwing. For `status` / `doctor` verbs.
 */
export declare function describeLocalOptIn(name: string, env?: Env): LocalOptInDescription;
/**
 * Does this process deliberately select the on-box store?
 *
 * Evaluated BEFORE any Keychain or disk read, from the process env alone.
 * Returns `true` when `HASNA_<APP>_LOCAL` is `1|true|yes` and no hosted client
 * key is declared beside it; `false` when the flag is absent, off, or
 * unrecognised. THROWS `ClientResolutionError` with code
 * `LOCAL_OPT_IN_CONFLICT` (exit 6) when the flag is on while
 * `HASNA_<APP>_API_URL`, `_API_KEY`, `_API_KEY_OVERRIDE`, `_API_KEY_REF`,
 * the unprefixed aliases, or `HASNA_PROFILE` are also declared — a process
 * runs against exactly one store, and it must say which.
 */
export declare function selectsLocalStore(name: string, env?: Env): boolean;
/**
 * The single stderr line an app prints when the on-box store is selected.
 * Text only — never a JSON event on stdout, where it would be mistaken for data.
 */
export declare function localStoreNotice(name: string, storePath: string): string;
