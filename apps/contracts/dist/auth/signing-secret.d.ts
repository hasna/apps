import type { Env } from "../env-token.js";
import type { SigningSecret } from "./keys.js";
/**
 * The env keys an app's signing secret is read from, in precedence order.
 *
 * The shared `HASNA_API_SIGNING_KEY` is the fallback a single-app deployment
 * uses; the per-app key wins so one process can serve two apps.
 */
export declare function signingSecretEnvKeys(app: string): string[];
/** A signing secret could not be resolved. Names the env keys, never a value. */
export declare class SigningSecretError extends Error {
    readonly attempted: readonly string[];
    constructor(message: string, attempted: readonly string[]);
}
/**
 * Normalize a signing secret for keying.
 *
 * A string is trimmed; binary shapes are returned untouched, because a caller
 * that handed over bytes chose those exact bytes and there is no "whitespace" to
 * strip from a `Uint8Array` without guessing at an encoding.
 */
export declare function normalizeSigningSecret(secret: SigningSecret): SigningSecret;
/**
 * True when a stored secret carries leading or trailing whitespace.
 *
 * For provisioning checks: a value that needs trimming is one every reader must
 * remember to trim, and the fleet has already proved that some do not.
 */
export declare function signingSecretHasSurroundingWhitespace(value: string): boolean;
/** A resolved signing secret plus the env key that supplied it. */
export interface ResolvedSigningSecret {
    /** The trimmed secret. Never logged by this module. */
    value: string;
    /** The env key NAME it came from. */
    source: string;
    /** True when the stored value carried surrounding whitespace that was trimmed. */
    trimmed: boolean;
}
export interface ResolveSigningSecretOptions {
    /**
     * Read this env key instead of the derived pair. An explicit selection is
     * terminal: it never falls back to `HASNA_API_SIGNING_KEY`, because signing
     * with a different secret than the operator named produces keys the server
     * rejects — the exact failure this module exists to end.
     */
    envName?: string;
}
/**
 * Resolve an app's signing secret from the environment, trimmed.
 *
 * Throws {@link SigningSecretError} when no key holds a usable value: a missing
 * signing secret cannot be worked around, and continuing would mint keys under
 * an empty HMAC key.
 */
export declare function resolveSigningSecret(app: string, env: Env, options?: ResolveSigningSecretOptions): ResolvedSigningSecret;
