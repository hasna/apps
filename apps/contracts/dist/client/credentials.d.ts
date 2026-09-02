import type { Env } from "../env-token.js";
/** Which link of the chain supplied the credential. */
export type CredentialTier = "argument" | "override" | "pointer" | "profile" | "disk" | "config" | "legacy-env";
export interface ResolvedCredential {
    /**
     * The secret.
     *
     * NON-ENUMERABLE on purpose, so `Object.keys`, `{ ...resolved }`, and
     * `JSON.stringify(resolution)` cannot spill it; and separately REDACTED by a
     * custom-inspect hook, because non-enumerability alone does not stop an
     * inspector — `console.log` printed it verbatim under Bun until the hook was
     * added. CONTRACT.md §3a promises both. Property access (`resolved.apiKey`)
     * and destructuring still work; only enumeration, serialization, and printing
     * are blocked. Note that `{ ...resolved }` therefore DROPS the key — which is
     * the safe direction.
     */
    readonly apiKey: string;
    readonly tier: CredentialTier;
    /** Where it came from: an env key NAME or an absolute file path. Never a value. */
    readonly source: string;
    /** True for tiers an operator sets on purpose. These never fall through. */
    readonly deliberate: boolean;
    /** True when it came from the deprecated process-environment tier. */
    readonly deprecated: boolean;
    /**
     * When tier === "pointer", the vault ITEM KEY to resolve through the
     * @hasna/secrets SDK at request time. Never a credential value. Non-enumerable
     * like apiKey, so it cannot be spilled by enumeration or serialization.
     */
    readonly pointerVaultKey?: string;
    /**
     * The disk paths that were consulted before this credential was chosen.
     *
     * Carried so an auth failure can tell an operator exactly where the fleet
     * credential SHOULD live, instead of advising a fix that silently drops the
     * client onto its local store.
     */
    readonly diskCandidates: readonly string[];
    /** Human-readable advisory. Never contains key material. */
    readonly warning: string | null;
}
export interface CredentialChainOptions {
    /** Tier 1: an explicit key, e.g. from `--api-key`. */
    apiKey?: string;
    /** Tier 1: an explicit profile name, e.g. from `--profile`. Beats `HASNA_PROFILE`. */
    profile?: string;
    /**
     * Sink for the one-line legacy-env deprecation. Defaults to a once-per-app
     * stderr writer. Injected by tests so they never touch the real stderr.
     */
    onDeprecation?: (message: string) => void;
}
/**
 * A deliberate credential selection could not be honoured, or a credential
 * source produced something unusable.
 *
 * Thrown rather than resolved-around: an override or profile pointer that
 * cannot produce a key must fail loudly, because the alternative is acting as
 * a different principal than the operator asked for. A corrupt credential file
 * throws for the same reason.
 */
export declare class CredentialResolutionError extends Error {
    readonly appName: string;
    readonly attempted: readonly string[];
    constructor(appName: string, message: string, attempted: readonly string[]);
}
/** An existing credential/config file is unsafe and is never treated as absent. */
export declare class CredentialFileUnsafeError extends Error {
    readonly path: string;
    constructor(path: string, reason: string);
}
/** One on-disk credential source: its absolute path, its tier, and whether it is deprecated. */
export interface DiskCredentialSource {
    path: string;
    tier: CredentialTier;
    /** Retained in the public shape; canonical XDG sources are never deprecated. */
    deprecated: boolean;
}
/**
 * All on-disk credential sources for an app, in precedence order.
 *
 * Exactly one XDG layer exists. Returns an empty list when there is no HOME to
 * anchor the default, or when the app name is not safe to place in a path.
 */
export declare function credentialDiskSourceList(name: string, env: Env, profile?: string | null): DiskCredentialSource[];
/**
 * The disk files that may hold an app's credential, in precedence order.
 *
 * Exactly one XDG layer exists. Exported so callers and error messages can name
 * the exact path consulted.
 */
export declare function credentialDiskSources(name: string, env: Env): string[];
/** A non-secret config value read off disk, with the file that supplied it. */
export interface AppConfigDiskHit {
    /** The key that matched, in the caller's precedence order. */
    key: string;
    /** The value as written in the file. Never a credential — see below. */
    value: string;
    /** Absolute path of the file that supplied it, so a diagnostic can name it. */
    path: string;
    /** The key was explicitly declared but blank or malformed. */
    unusable?: boolean;
}
/**
 * Read a NON-SECRET config value from the fleet app-config file on disk.
 *
 * This is the tier that closes the gap the credential chain left open: the same
 * file already supplies the API key, and every other field in it was discarded.
 * A non-interactive shell may inherit no service environment, so this source
 * keeps the authority and credential together without introducing a local-data
 * fallback.
 *
 * Precedence is file-major, then the caller's key order within a file: the first
 * disk layer that can answer wins, and inside it the caller's first key wins
 * over the file's line order.
 *
 * Values found here are NOT policed for legacy-ness. A live fleet file may still
 * carry keys this reader never asks for; it simply ignores them. Throwing on a
 * file's contents would take down every client on the fleet for a stale line
 * nobody reads.
 */
export declare function appConfigDiskValue(name: string, env: Env, keys: readonly string[]): AppConfigDiskHit | null;
export declare const CALLER_SUPPLIED_CREDENTIAL_PROVIDER_SOURCE = "caller-supplied CredentialProvider";
/**
 * Build the credential for a key a caller handed in DIRECTLY as a string.
 *
 * `createHasnaHttpTransport({ apiKey })` accepts a bare string, and that branch
 * used to construct its resolution as an object literal — reaching the request
 * having run NEITHER {@link assertUsableCredential} NOR {@link sealCredential},
 * so the one public constructor most consumers call bypassed both protections
 * this module exists to provide. A key carrying a CR then travelled all the way
 * into `fetch`, which rejects it with a `TypeError` whose message quotes THE
 * WHOLE HEADER VALUE — putting the plaintext key into logs and stack traces,
 * which is the exact failure `ILLEGAL_IN_HEADER_VALUE` was added to prevent.
 *
 * Every credential in this system is now built here or by
 * {@link resolveCredential}. There is deliberately no third construction site.
 */
export declare function explicitCredential(appName: string, apiKey: string): ResolvedCredential;
/**
 * Reapply the credential protections at a caller-supplied provider boundary.
 *
 * A {@link ResolvedCredential} is structurally typed, so a caller can satisfy
 * the provider contract with a plain object instead of a value returned by one
 * of the credential constructors. Snapshot its key once, validate it, and
 * preserve diagnostic metadata only when the value already carries the internal
 * seal those constructors apply. Raw provider-shaped objects keep the key, but
 * not untrusted metadata that could be printed by an auth failure.
 */
export declare function validateAndSealResolvedCredential(appName: string, credential: ResolvedCredential): ResolvedCredential;
/** Test seam: forget which apps have already emitted their deprecation. */
export declare function __resetCredentialDeprecationNotices(): void;
/**
 * Resolve an app's API key through the provider chain, at call time.
 *
 * Returns `null` when no tier produces a credential. THROWS
 * {@link CredentialResolutionError} when a DELIBERATE tier was selected but
 * could not be honoured, or when a credential is unusable — silently
 * continuing in either case would authenticate as somebody other than the
 * principal the operator named.
 */
export declare function resolveCredential(name: string, env: Env, options?: CredentialChainOptions): ResolvedCredential | null;
/**
 * Complete a pointer-tier resolution through the secrets vault.
 *
 * Called by the transport at REQUEST time, never at construction. The pointer
 * is a DELIBERATE selection, so every failure — SDK not installed, client
 * unconfigured, vault unreachable, item missing or empty — is a TERMINAL
 * {@link CredentialResolutionError}. The chain never falls through to a
 * literal, an env var, or a local store: authenticating as a different
 * principal than the one the operator named is exactly the failure a
 * deliberate pointer exists to prevent.
 *
 * The @hasna/secrets module is imported lazily (via a non-literal specifier)
 * so consumers that never set a pointer pay no import cost and need no peer
 * dependency at load time; a pointer REQUIRES it, and its absence is one of
 * the TERMINAL cases.
 */
export declare function completePointerCredential(name: string, pointerResolution: ResolvedCredential, env?: Env): Promise<ResolvedCredential>;
