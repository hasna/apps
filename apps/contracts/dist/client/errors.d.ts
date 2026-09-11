/** The discriminated failure codes, in the order they are documented. */
export declare const CLIENT_RESOLUTION_CODES: readonly ["CREDENTIAL_ABSENT", "CREDENTIAL_UNREADABLE", "CREDENTIAL_REJECTED", "AUTHORITY_MISSING", "AUTHORITY_INVALID", "AUTHORITY_CONFLICT", "LOCAL_OPT_IN_CONFLICT", "TRANSPORT_UNAVAILABLE", "NOT_AVAILABLE_HOSTED"];
export type ClientResolutionCode = (typeof CLIENT_RESOLUTION_CODES)[number];
/**
 * The process exit code for each failure code. Stable: a change here is a
 * breaking change for every adopter's CLI contract and every black-box probe.
 */
export declare const CLIENT_RESOLUTION_EXIT_CODES: Readonly<Record<ClientResolutionCode, number>>;
/** One-line, value-free descriptions for `status` / `doctor` output and docs. */
export declare const CLIENT_RESOLUTION_CODE_DESCRIPTIONS: Readonly<Record<ClientResolutionCode, string>>;
export declare function isClientResolutionCode(value: unknown): value is ClientResolutionCode;
/** The exit code for a code. */
export declare function exitCodeForClientResolutionCode(code: ClientResolutionCode): number;
export interface ClientResolutionErrorOptions {
    /** Env key NAMES, absolute PATHS, or Keychain item REFERENCES. Never values. */
    sources?: readonly string[];
    /** What a human should do. Never contains a value. */
    remedy?: string | null;
    cause?: unknown;
}
/** The serialisable envelope. Emitted by `toJSON()`; never carries a value. */
export interface ClientResolutionErrorJson {
    name: string;
    code: ClientResolutionCode;
    exitCode: number;
    app: string | null;
    message: string;
    sources: string[];
    remedy: string | null;
}
/**
 * The base of every client-side resolution failure.
 *
 * Thrown rather than resolved around: a client that cannot prove which
 * principal it acts as, or which authority it talks to, sends nothing and
 * opens no store.
 */
export declare class ClientResolutionError extends Error {
    readonly code: ClientResolutionCode;
    readonly exitCode: number;
    readonly app: string | null;
    readonly sources: readonly string[];
    readonly remedy: string | null;
    constructor(code: ClientResolutionCode, app: string | null, message: string, options?: ClientResolutionErrorOptions);
    toJSON(): ClientResolutionErrorJson;
}
export declare function isClientResolutionError(value: unknown): value is ClientResolutionError;
/**
 * The failure code carried by ANY error this package throws, or null.
 *
 * Duck-typed on purpose: `HasnaHttpError` is not a resolution error but
 * carries a `code` for 401/403 and retryable statuses, and a consumer bundling
 * two copies of this package must still classify the other copy's errors.
 */
export declare function clientResolutionCodeOf(error: unknown): ClientResolutionCode | null;
/** The exit code an adopter CLI should use for `error`; `fallback` when it is not ours. */
export declare function clientResolutionExitCode(error: unknown, fallback?: number): number;
export interface FormatClientResolutionFailureOptions {
    /** App slug to prefix the line with; defaults to the error's own `app`. */
    app?: string | null;
    /** Emit the `toJSON()` envelope instead of the one-line text. */
    json?: boolean;
}
/**
 * The one line an adopter CLI prints to STDERR before exiting with
 * {@link clientResolutionExitCode}: `<app>: <CODE>: <message> <remedy>`.
 * With `json`, the `toJSON()` envelope (still for stderr, never stdout).
 */
export declare function formatClientResolutionFailure(error: ClientResolutionError, options?: FormatClientResolutionFailureOptions): string;
