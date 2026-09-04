import { type Env } from "../env-token.js";
import { type CredentialChainOptions, type CredentialTier, type ResolvedCredential } from "./credentials.js";
export { appConfigDiskValue, completePointerCredential, credentialDiskSourceList, credentialDiskSources, CredentialResolutionError, explicitCredential, HASNA_CONFIG_HOME_ENV_KEY, HASNA_HOME_ENV_KEY, KEYCHAIN_STATION_ENV_KEY, keychainConfigValue, resolveCredential, } from "./credentials.js";
export type { AppConfigDiskHit, CredentialChainOptions, CredentialTier, DiskCredentialSource, KeychainCommandResult, KeychainCommandRunner, KeychainItemHit, KeychainTierOptions, ResolvedCredential, } from "./credentials.js";
export { clientTransportEnvKeys, credentialOverrideEnvKey, credentialPointerEnvKey, CREDENTIAL_PROFILE_ENV_KEY, } from "./env-keys.js";
export type { ClientTransportEnvKeys } from "./env-keys.js";
/**
 * The fleet gateway every app is served through, path-prefixed by app:
 * `https://api.hasna.com/<app>` (the client appends `/v1`). It is the DEFAULT
 * authority when nothing configures a URL — a key from any tier is enough to
 * reach the fleet, and URLs never need configuring (owner directive,
 * 2026-09-04). `HASNA_<NAME>_API_URL`, the Keychain `api-url` item, and the
 * credentials file all override it. This is a PUBLIC hostname; the per-app
 * origin domain behind the gateway stays unnamed here (see `fleetApiDomain`).
 */
export declare const DEFAULT_FLEET_GATEWAY_ORIGIN = "https://api.hasna.com";
/** The `apiUrlSource` / `transportSource` reported when the default gateway applies. */
export declare const DEFAULT_AUTHORITY_SOURCE = "default";
/** `https://api.hasna.com/<app>` for a valid app slug; throws for an unsafe name. */
export declare function defaultFleetGatewayBaseUrl(name: string): string;
/**
 * Fleet API domain suffix for a per-app ORIGIN hostname. This published
 * package never ships a real origin hostname: override with
 * `HASNA_FLEET_API_DOMAIN` or set an explicit `HASNA_<NAME>_API_URL` per app.
 * (Clients need neither any more — `resolveClientTransport` defaults to the
 * public gateway, `DEFAULT_FLEET_GATEWAY_ORIGIN`.) Absent both,
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
export declare const CLIENT_TRANSPORTS: readonly ["http"];
export type ClientTransportKind = (typeof CLIENT_TRANSPORTS)[number];
/** A client authority or credential declaration cannot be used safely. */
export declare class ClientTransportConfigurationError extends Error {
    readonly appName: string;
    readonly sources: readonly string[];
    constructor(appName: string, message: string, sources?: readonly string[]);
}
export interface ClientTransportResolution {
    /** Where the client should read/write from. */
    transport: ClientTransportKind;
    /**
     * What selected the transport: an API URL env key NAME, a Keychain item
     * reference, the absolute PATH of the credentials file that supplied the
     * URL, or `"default"` when the fleet gateway applied.
     */
    transportSource: string;
    /** `<origin>/v1` base for the server API. */
    baseUrl: string;
    /**
     * WHERE the API URL/domain came from: an env key NAME, a Keychain item
     * reference, an absolute file PATH, `"default"` (the fleet gateway), or null.
     */
    apiUrlSource: string | null;
    /** Whether an API key is present (value never exposed). */
    apiKeyPresent: boolean;
    /**
     * WHERE the API key came from: an env key NAME or an absolute file path.
     * Never the value.
     *
     * Names the tier of the provider chain that supplied the key.
     */
    apiKeySource: string | null;
    /**
     * Which tier of the credential chain supplied the key.
     */
    apiKeyTier: CredentialTier;
    /**
     * Kept for diagnostic shape compatibility. A successful resolution is never
     * misconfigured; invalid configurations throw before a value is returned.
     */
    misconfigured: boolean;
    /** Human-readable warning, or null. Never contains secret values. */
    warning: string | null;
}
export interface ResolveClientTransportOptions {
    /** Tier-1 credential inputs (`--api-key` / `--profile`) and Keychain-tier controls. */
    credentials?: CredentialChainOptions;
}
/**
 * Resolve the sole authenticated service transport without exposing its
 * credential value. Invalid or incomplete configuration throws.
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
 * Build an authenticated HTTP transport from a static authority and a
 * per-request credential provider.
 */
export declare function createHasnaHttpTransport(options: HasnaHttpTransportOptions): HasnaHttpTransport;
/**
 * Resolve the sole public client transport and build it. Missing, blank,
 * conflicting, or invalid authority/credential configuration throws; there is
 * no local-data return branch.
 */
export declare function createClientTransport(name: string, env?: Env, overrides?: Partial<Pick<HasnaHttpTransportOptions, "fetchImpl" | "headers" | "timeoutMs" | "retry" | "sleepImpl">> & {
    /** Tier-1 credential inputs, e.g. from `--api-key` / `--profile` flags. */
    credentials?: CredentialChainOptions;
}): {
    transport: "http";
    client: HasnaHttpTransport;
    resolution: ClientTransportResolution;
};
