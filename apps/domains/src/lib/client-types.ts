// The @hasna/contracts client types that @hasna/domains PUBLISHES.
//
// WHY THIS FILE EXISTS. `@hasna/contracts` is a BUILD-TIME dependency of this
// package: `bun build --target bun` inlines the resolver into every bundle, so
// `dist/*.js` imports node builtins only and a consumer installs nothing extra.
// The declarations `tsc` emits are not bundled, though — they keep every import
// the source wrote. `src/db/store.ts` hands the resolved storage client to
// `ApiStore` and re-exports it from the package entry (`dist/index.d.ts` ->
// `dist/db/store.d.ts`), so a TS consumer with only this package's runtime
// dependencies installed would get TS2307 "Cannot find module
// '@hasna/contracts/client/storage'". The published types are therefore spelled
// HERE, and every one of them is asserted identical to the @hasna/contracts
// declaration it mirrors by `client-types.test.ts` (hasna/apps#1782).
//
// WHAT THIS IS NOT. It is NOT a vendored resolver. There is no logic here — no
// tier, no Keychain read, no URL ladder, not one runtime statement. The
// resolver still lives in @hasna/contracts and only there; this file is the
// SPELLING of the shapes that cross this package's published boundary.
//
// Nothing in here imports anything. That is the invariant: this module is the
// leaf of the published declaration graph.

/** An environment as the client resolver reads it. */
export type ClientEnv = Record<string, string | undefined>;

/** The env-key spec for one app, in precedence order. */
export interface ClientTransportEnvKeys {
  /** API base-URL keys, in precedence order. */
  apiUrlKeys: string[];
  /** API-key keys, in precedence order. */
  apiKeyKeys: string[];
}

/** Which tier of the credential chain supplied a key. */
export type CredentialTier =
  | "argument"
  | "override"
  | "pointer"
  | "profile"
  | "keychain"
  | "disk"
  | "env";

/**
 * A credential resolved from one tier of the chain.
 *
 * `apiKey` is non-enumerable and redacted by a custom-inspect hook in the
 * resolver, so spreading or serializing a resolution drops it. That is a
 * runtime property of the value, not something a type can carry.
 */
export interface ResolvedCredential {
  readonly apiKey: string;
  readonly tier: CredentialTier;
  /** An env key NAME, an absolute file path, or `keychain:<service>@<account>`. Never a value. */
  readonly source: string;
  /** True for tiers an operator sets on purpose. These never fall through. */
  readonly deliberate: boolean;
  /** For `tier === "pointer"`, the vault ITEM KEY to resolve at request time. Never a value. */
  readonly pointerVaultKey?: string;
  /** The disk paths consulted before this credential was chosen. */
  readonly diskCandidates: readonly string[];
  /** Human-readable advisory. Never contains key material. */
  readonly warning: string | null;
}

/**
 * A per-request credential source.
 *
 * Prefer this over a bare string for a long-lived client: the transport calls
 * it fresh for every request, so a key rotation heals without a rebuild.
 */
export type CredentialProvider = () => ResolvedCredential;

/** The captured outcome of one `security` invocation. `stdout` IS the secret. */
export interface KeychainCommandResult {
  /** Exit status; null when the tool could not be started or was killed. */
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `/usr/bin/security` with the given argv — no shell. Injected by tests. */
export type KeychainCommandRunner = (argv: readonly string[]) => KeychainCommandResult;

/** Keychain-tier controls. Every field is optional; production callers pass nothing. */
export interface KeychainTierOptions {
  /**
   * Whether the Keychain is consulted for a caller-built env object. The tier is
   * AMBIENT: by default it runs only for the live `process.env`. Injecting `run`
   * implies `true`.
   */
  enabled?: boolean;
  /** Defaults to `process.platform`; the tier exists only on `"darwin"`. */
  platform?: string;
  /** The machine's host name (label before the first dot), used when `HASNA_STATION` is unset. */
  hostname?: () => string;
  /** The `security` runner. Defaults to spawning `/usr/bin/security` by argv. */
  run?: KeychainCommandRunner;
}

/** Tier-1 credential inputs (`--api-key` / `--profile`) plus the Keychain-tier seam. */
export interface CredentialChainOptions {
  /** Tier 1: an explicit key, e.g. from `--api-key`. */
  apiKey?: string;
  /** Tier 1: an explicit profile name, e.g. from `--profile`. Beats `HASNA_PROFILE`. */
  profile?: string;
  /** Tier 3: Keychain controls — a fake `security` runner in tests, an opt-out on CI. */
  keychain?: KeychainTierOptions;
}

/** Where a client reads and writes. There is one: the authenticated service API. */
export type ClientTransportKind = "http";

/** The transport decision, with every source named and no key value in it. */
export interface ClientTransportResolution {
  /** Where the client should read/write from. */
  transport: ClientTransportKind;
  /** What selected the transport: an env key NAME, a Keychain item reference, a file PATH, or `"default"`. */
  transportSource: string;
  /** `<origin>/v1` base for the server API. */
  baseUrl: string;
  /** WHERE the API URL came from: an env key NAME, a Keychain item reference, a file PATH, `"default"`, or null. */
  apiUrlSource: string | null;
  /** Whether an API key is present (value never exposed). */
  apiKeyPresent: boolean;
  /** WHERE the API key came from: an env key NAME or an absolute file path. Never the value. */
  apiKeySource: string | null;
  /** Which tier of the credential chain supplied the key. */
  apiKeyTier: CredentialTier;
  /** Kept for diagnostic shape compatibility; a successful resolution is never misconfigured. */
  misconfigured: boolean;
  /** Human-readable warning, or null. Never contains secret values. */
  warning: string | null;
}

/** Query string params appended to a request URL. */
export type QueryParams =
  | URLSearchParams
  | Record<string, string | number | boolean | null | undefined | ReadonlyArray<string | number | boolean>>;

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
  /** Idempotency key sent as `Idempotency-Key`, making an unsafe method safe to retry. */
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

/** The authenticated HTTP transport. The API key lives inside it and is never returned. */
export interface HasnaHttpTransport {
  readonly baseUrl: string;
  request<T = unknown>(method: string, path: string, body?: unknown, opts?: HasnaRequestOptions): Promise<T>;
  get<T = unknown>(path: string, opts?: HasnaRequestOptions): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, opts?: HasnaRequestOptions): Promise<T>;
  put<T = unknown>(path: string, body?: unknown, opts?: HasnaRequestOptions): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown, opts?: HasnaRequestOptions): Promise<T>;
  del<T = unknown>(path: string, body?: unknown, opts?: HasnaRequestOptions): Promise<T>;
}

/** Options for a `list()` call: filters/pagination as query params. */
export interface StorageListOptions extends Pick<HasnaRequestOptions, "timeoutMs" | "headers" | "retry" | "signal"> {
  /** Query params (limit, offset, cursor, filters, ...). */
  query?: QueryParams;
}

/** Options for a `get()` call. */
export type StorageGetOptions = Pick<HasnaRequestOptions, "timeoutMs" | "headers" | "retry" | "signal" | "query">;

/** Options for a `create()` call. */
export interface StorageCreateOptions
  extends Pick<HasnaRequestOptions, "timeoutMs" | "headers" | "retry" | "signal" | "query"> {
  /** Defaults to a fresh UUID so a retried POST is deduped rather than duplicated. */
  idempotencyKey?: string;
}

/** Options for an `update()` call. */
export interface StorageUpdateOptions
  extends Pick<HasnaRequestOptions, "timeoutMs" | "headers" | "retry" | "signal" | "query"> {
  /** HTTP verb for the update. Default `PATCH` (partial); use `PUT` for replace. */
  method?: "PATCH" | "PUT";
  /** Idempotency key. Set this to make a PATCH retry-safe too. */
  idempotencyKey?: string;
}

/** Options for a `delete()` call. */
export type StorageDeleteOptions = Pick<HasnaRequestOptions, "timeoutMs" | "headers" | "retry" | "signal" | "query">;

/** Result of a `list()` call. `items` is the extracted array; `raw` is the full envelope. */
export interface StorageListResult<T> {
  items: T[];
  /** Total count when the server reports one (`total`/`count`), else null. */
  total: number | null;
  /** Opaque pagination cursor when the server reports one, else null. */
  cursor: string | null;
  /** The full parsed response body (envelope preserved). */
  raw: unknown;
}

/** The app storage interface exposed by the authenticated service API. */
export interface HasnaStorageClient {
  /** App slug this client targets. */
  readonly name: string;
  /** `<origin>/v1` base URL. */
  readonly baseUrl: string;
  /** The underlying HTTP transport (escape hatch for non-CRUD routes). */
  readonly transport: HasnaHttpTransport;

  /** List a collection. Returns extracted `items` plus the raw envelope. */
  list<T = unknown>(resource: string, options?: StorageListOptions): Promise<StorageListResult<T>>;
  /** Fetch one entity by id. Returns `null` on 404. */
  get<T = unknown>(resource: string, id: string, options?: StorageGetOptions): Promise<T | null>;
  /** Create one entity. Retry-safe via an auto `Idempotency-Key`. */
  create<T = unknown>(resource: string, body: unknown, options?: StorageCreateOptions): Promise<T>;
  /** Update one entity by id (PATCH by default). */
  update<T = unknown>(resource: string, id: string, patch: unknown, options?: StorageUpdateOptions): Promise<T>;
  /** Delete one entity by id. Resolves for 2xx and 404 (already gone). */
  delete(resource: string, id: string, options?: StorageDeleteOptions): Promise<void>;
}