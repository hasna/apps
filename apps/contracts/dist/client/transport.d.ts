import { type Env } from "../env-token.js";
import { type CredentialChainOptions, type CredentialTier, type ResolvedCredential } from "./credentials.js";
export { LEGACY_CLOUD_REMOVAL_DEADLINE, appConfigDiskValue, completePointerCredential, credentialDiskSourceList, credentialDiskSources, CredentialResolutionError, explicitCredential, resolveCredential, __resetCredentialDeprecationNotices, } from "./credentials.js";
export type { AppConfigDiskHit, CredentialChainOptions, CredentialTier, DiskCredentialSource, ResolvedCredential, } from "./credentials.js";
export { clientTransportEnvKeys, credentialOverrideEnvKey, credentialPointerEnvKey, CREDENTIAL_PROFILE_ENV_KEY, } from "./env-keys.js";
export type { ClientTransportEnvKeys } from "./env-keys.js";
/**
 * Fleet API domain suffix. This published package never ships a real internal
 * hostname: override with `HASNA_FLEET_API_DOMAIN` (REQUIRED in a real
 * deployment) or set an explicit `HASNA_<NAME>_API_URL` per app. Absent both,
 * this falls back to a neutral placeholder that intentionally does not
 * resolve to any service. Blank, malformed, and suffixes that cannot form a
 * valid total hostname with the app prefix use the same deterministic
 * placeholder; `resolveClientTransport()` marks that fallback misconfigured so
 * authenticated clients fail before making a request.
 */
export declare function fleetApiDomain(env?: Env): string;
/** Default cloud host template. `<app>` is the app slug. */
export declare function defaultCloudBaseUrl(name: string, env?: Env): string;
/**
 * Normalize an explicit API base URL to `<origin>/v1`.
 *
 * HTTPS may target any explicit ASCII hostname. HTTP is restricted to exact
 * loopback authorities for local development. Paths and ports are preserved;
 * query strings, fragments, credentials, controls, IDNs, and punycode are
 * rejected rather than silently normalized.
 */
export declare function toV1BaseUrl(apiUrl: string): string;
export declare const CLIENT_TRANSPORTS: readonly ["sqlite", "http"];
export type ClientTransportKind = (typeof CLIENT_TRANSPORTS)[number];
export interface ClientTransportResolution {
    /** Where the client should read/write from. */
    transport: ClientTransportKind;
    /**
     * What selected the transport: an API URL env key NAME, the absolute PATH of
     * the fleet app-config file that supplied the URL, `"default"` for local
     * SQLite with a silent environment, or the env key NAME of a DEFINED-but-blank
     * URL that explicitly selected local.
     */
    transportSource: string;
    /** `<origin>/v1` base for the server API when transport is http, else null. */
    baseUrl: string | null;
    /**
     * WHERE the API URL/domain came from: an env key NAME, an absolute file PATH,
     * `"default"` (neutral placeholder), or null.
     */
    apiUrlSource: string | null;
    /** Whether an API key is present (value never exposed). */
    apiKeyPresent: boolean;
    /**
     * WHERE the API key came from: an env key NAME or an absolute file path.
     * Never the value.
     *
     * On local SQLite this reports only whether the legacy env key is set, since
     * a client reading its own file resolves no credential at all. On HTTP it
     * names the tier of the provider chain that supplied the key.
     */
    apiKeySource: string | null;
    /**
     * Which tier of the credential chain supplied the key, or null on the
     * local SQLite / when no credential resolved. See {@link CredentialTier}.
     */
    apiKeyTier: CredentialTier | null;
    /**
     * True when an API URL requests HTTP but the connection is incomplete.
     * Callers SHOULD treat this as an error rather than reading stale local data.
     */
    misconfigured: boolean;
    /** Human-readable warning, or null. Never contains secret values. */
    warning: string | null;
}
export interface ResolveClientTransportOptions {
    /** Tier-1 credential inputs, e.g. from `--api-key` / `--profile` flags. */
    credentials?: CredentialChainOptions;
}
/**
 * Resolve how a client should reach an app's data given the environment.
 *
 * An explicit API URL requests HTTP. It is read from the environment first and,
 * when the environment is silent, from the fleet app-config file on disk — the
 * same file the credential tier already reads. The credential resolves at CALL
 * TIME through {@link resolveCredential}: argument, deliberate override/profile,
 * disk, then the deprecated legacy env variable. With no API URL in either tier
 * the client stays on local SQLite and never consults credential files.
 *
 * The disk tier is a FALLBACK and never an override: an API URL exported in the
 * environment always wins over the file. It exists because a non-interactive
 * shell inherits no fleet environment, and the honest answer for one is the
 * config its operator actually wrote down — not a silent local-store read at
 * `misconfigured: false`.
 */
export declare function resolveClientTransport(name: string, env?: Env, options?: ResolveClientTransportOptions): ClientTransportResolution;
/** Thrown when a cloud HTTP request returns a non-2xx status, including redirects. */
export declare class HasnaHttpError extends Error {
    readonly status: number;
    readonly method: string;
    readonly path: string;
    readonly body: unknown;
    /** WHICH source supplied the rejected key (an env key name or a file path). Never a value. */
    readonly credentialSource: string | null;
    /** Which tier of the provider chain supplied it. */
    readonly credentialTier: CredentialTier | null;
    constructor(method: string, path: string, status: number, body: unknown, credential?: {
        source: string;
        tier: CredentialTier;
        guidance: string;
    } | null);
}
/**
 * A credential resolved fresh for one request.
 *
 * The transport takes a PROVIDER rather than a string so that a long-lived
 * process — an MCP server, a daemon — picks up a key rotation without being
 * rebuilt. Resolving once when the client is constructed would just move the
 * stale snapshot from process start to client construction.
 */
export type CredentialProvider = () => ResolvedCredential;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
/** Query params for a request. Nullish values are dropped; arrays repeat the key. */
export type QueryParams = URLSearchParams | Record<string, string | number | boolean | null | undefined | ReadonlyArray<string | number | boolean>>;
/** Retry policy for transient failures (network errors, timeouts, 5xx, 429). */
export interface HasnaRetryOptions {
    /** Max RETRY attempts after the first try. Default 2 (=> up to 3 total tries). */
    retries?: number;
    /** Base backoff in ms for exponential backoff. Default 200. */
    baseDelayMs?: number;
    /** Backoff ceiling in ms. Default 2000. */
    maxDelayMs?: number;
    /** HTTP statuses that trigger a retry. Default 408, 425, 429, 500, 502, 503, 504. */
    retryStatuses?: number[];
}
/** Per-call request options: query, idempotency, timeout, retry, extra headers. */
export interface HasnaRequestOptions {
    /** Query string params appended to the URL. */
    query?: QueryParams;
    /**
     * Idempotency key sent as `Idempotency-Key`. When set, unsafe methods (POST)
     * become safe to retry: the server dedupes replays. Auto-generated for
     * `create()` in the storage client.
     */
    idempotencyKey?: string;
    /** Override the transport timeout for this call (ms). */
    timeoutMs?: number;
    /** Extra headers merged into this call (override transport headers). */
    headers?: Record<string, string>;
    /** Override or disable retry for this call. `false` disables retries. */
    retry?: HasnaRetryOptions | false;
    /** Caller abort signal, combined with the internal timeout. */
    signal?: AbortSignal;
}
export interface HasnaHttpTransportOptions {
    /** App slug (for error context / default host). */
    name: string;
    /** `<origin>/v1` base. Usually from `resolveClientTransport().baseUrl`. */
    baseUrl: string;
    /**
     * The API key (secret), or a provider that resolves one per request.
     *
     * Pass a provider (see {@link CredentialProvider}) so rotation heals inside a
     * long-lived process. A plain string is still accepted and is treated as a
     * deliberate, explicit credential.
     */
    apiKey: string | CredentialProvider;
    /** Override fetch (tests). Defaults to global fetch. */
    fetchImpl?: FetchLike;
    /** Extra headers merged into every request. */
    headers?: Record<string, string>;
    /** Per-request timeout in ms. Default 30000. */
    timeoutMs?: number;
    /** Default retry policy for all requests. Pass `false` to disable. */
    retry?: HasnaRetryOptions | false;
    /** Injectable sleep (tests). Defaults to a real timer. */
    sleepImpl?: (ms: number) => Promise<void>;
}
export interface HasnaHttpTransport {
    readonly baseUrl: string;
    request<T = unknown>(method: string, path: string, body?: unknown, opts?: HasnaRequestOptions): Promise<T>;
    get<T = unknown>(path: string, opts?: HasnaRequestOptions): Promise<T>;
    post<T = unknown>(path: string, body?: unknown, opts?: HasnaRequestOptions): Promise<T>;
    put<T = unknown>(path: string, body?: unknown, opts?: HasnaRequestOptions): Promise<T>;
    patch<T = unknown>(path: string, body?: unknown, opts?: HasnaRequestOptions): Promise<T>;
    del<T = unknown>(path: string, body?: unknown, opts?: HasnaRequestOptions): Promise<T>;
}
/** Append query params to a `/v1`-relative path (no-op when empty). */
export declare function appendQuery(path: string, query?: QueryParams): string;
/**
 * Build an authenticated HTTP transport for an app's cloud `/v1` API. Sends the
 * API key on every request as BOTH `x-api-key` and `Authorization: Bearer`
 * (serve apps accept either), returns parsed JSON, times out, and retries
 * transient failures with exponential backoff + jitter. Never logs the key.
 * Redirects are never followed: every 3xx response fails closed at the validated
 * base origin so credentials and request bodies cannot cross an authority
 * boundary through runtime-specific redirect behavior.
 *
 * Retry safety: idempotent methods (GET/HEAD/PUT/DELETE/OPTIONS) are always
 * retried on transient failure; POST/PATCH are retried ONLY when an
 * `Idempotency-Key` is supplied, so replays can't create duplicates.
 */
export declare function createHasnaHttpTransport(options: HasnaHttpTransportOptions): HasnaHttpTransport;
/**
 * Convenience: resolve transport from env and, when http, build the HTTP
 * client in one call. Returns `{ transport: 'sqlite', resolution }` for the
 * local file, or `{ transport: 'http', client, resolution }` for server data.
 * Throws if the config is `misconfigured` (server data requested but unusable)
 * so callers can't drift onto local data by accident.
 */
export declare function createClientTransport(name: string, env?: Env, overrides?: Partial<Pick<HasnaHttpTransportOptions, "fetchImpl" | "headers" | "timeoutMs" | "retry" | "sleepImpl">> & {
    /** Tier-1 credential inputs, e.g. from `--api-key` / `--profile` flags. */
    credentials?: CredentialChainOptions;
}): {
    transport: "sqlite";
    client: null;
    resolution: ClientTransportResolution;
} | {
    transport: "http";
    client: HasnaHttpTransport;
    resolution: ClientTransportResolution;
};
