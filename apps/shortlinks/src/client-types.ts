// The @hasna/contracts client types that @hasna/shortlinks PUBLISHES.
//
// WHY THIS FILE EXISTS. `@hasna/contracts` is a BUILD-TIME dependency of this
// package: `bun build --target bun` inlines the resolver into every bundle, so
// `dist/*.js` imports node builtins only and a consumer installs nothing extra.
// The declarations `tsc` emits are not bundled, though — they keep every import
// the source wrote. When this package adopted the @hasna/contracts client
// resolver (hasna/apps#1720) the public types moved `import ... from
// "@hasna/contracts/client"` onto the emitted public type entries
// (`dist/index.d.ts` -> `dist/cloud-store.d.ts`, `dist/sdk/*.d.ts`), and a TS
// consumer with only this package's runtime dependencies installed would get
// TS2307 "Cannot find module '@hasna/contracts/client'". Those are documented
// public surfaces, so the fix is to publish the types rather than to publish a
// 20 MB build-time dependency to every consumer or to re-open the
// `shortlinks -> contracts -> peer @hasna/shortlinks` cycle.
//
// WHAT THIS IS NOT. It is NOT the vendored resolver this change removes. There
// is no logic here — no tier, no Keychain read, no URL ladder, not one runtime
// statement. The resolver still lives in @hasna/contracts and only there; this
// file is the SPELLING of the shapes that cross this package's published
// boundary. Every one of them is checked against the real @hasna/contracts
// declarations at compile time by `client-types.test.ts`, and by the ordinary
// assignments at the seams in `./cloud-store.ts` and `./sdk/resolve.ts` — a
// shape that drifts fails the build, it does not silently publish a lie.
//
// Nothing in here imports anything. That is the invariant: this module is the
// leaf of the published declaration graph.

/** An environment as the client resolver reads it. */
export type ShortlinksEnv = Record<string, string | undefined>;

/** The captured outcome of one `security` invocation. `stdout` IS the secret. */
export interface ShortlinksKeychainCommandResult {
  /** Exit status; null when the tool could not be started or was killed. */
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `/usr/bin/security` with the given argv — no shell. Injected by tests. */
export type ShortlinksKeychainCommandRunner = (argv: readonly string[]) => ShortlinksKeychainCommandResult;

/** Keychain-tier controls. Every field is optional; production callers pass nothing. */
export interface ShortlinksKeychainTierOptions {
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
  run?: ShortlinksKeychainCommandRunner;
}

/** Tier-1 credential inputs (`--api-key` / `--profile`) plus the Keychain-tier seam. */
export interface ShortlinksCredentialChainOptions {
  /** Tier 1: an explicit key, e.g. from `--api-key`. */
  apiKey?: string;
  /** Tier 1: an explicit profile name, e.g. from `--profile`. Beats `HASNA_PROFILE`. */
  profile?: string;
  /** Tier 3: Keychain controls — a fake `security` runner in tests, an opt-out on CI. */
  keychain?: ShortlinksKeychainTierOptions;
}

/** Query string params appended to a request URL. */
export type ShortlinksQueryParams =
  | URLSearchParams
  | Record<string, string | number | boolean | null | undefined | ReadonlyArray<string | number | boolean>>;

/** Retry policy for transient failures (network errors, timeouts, 5xx, 429). */
export interface ShortlinksRetryOptions {
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
export interface ShortlinksRequestOptions {
  /** Query string params appended to the URL. */
  query?: ShortlinksQueryParams;
  /** Idempotency key sent as `Idempotency-Key`, making an unsafe method safe to retry. */
  idempotencyKey?: string;
  /** Override the transport timeout for this call (ms). */
  timeoutMs?: number;
  /** Extra headers merged into this call (override transport headers). */
  headers?: Record<string, string>;
  /** Override or disable retry for this call. `false` disables retries. */
  retry?: ShortlinksRetryOptions | false;
  /** Caller abort signal, combined with the internal timeout. */
  signal?: AbortSignal;
}

/** The authenticated HTTP transport. The API key lives inside it and is never returned. */
export interface ShortlinksHttpTransport {
  readonly baseUrl: string;
  request<T = unknown>(method: string, path: string, body?: unknown, opts?: ShortlinksRequestOptions): Promise<T>;
  get<T = unknown>(path: string, opts?: ShortlinksRequestOptions): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, opts?: ShortlinksRequestOptions): Promise<T>;
  put<T = unknown>(path: string, body?: unknown, opts?: ShortlinksRequestOptions): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown, opts?: ShortlinksRequestOptions): Promise<T>;
  del<T = unknown>(path: string, body?: unknown, opts?: ShortlinksRequestOptions): Promise<T>;
}

/** The app storage interface exposed by the authenticated service API. */
export interface ShortlinksStorageClient {
  /** App slug this client targets. */
  readonly name: string;
  /** `<origin>/v1` base URL. */
  readonly baseUrl: string;
  /** The underlying HTTP transport (escape hatch for non-CRUD routes). */
  readonly transport: ShortlinksHttpTransport;

  /** List a collection. Returns extracted `items` plus the raw envelope. */
  list<T = unknown>(resource: string, options?: ShortlinksRequestOptions & { query?: ShortlinksQueryParams }): Promise<{ items: T[]; total: number | null; cursor: string | null; raw: unknown }>;
  /** Fetch one entity by id. Returns `null` on 404. */
  get<T = unknown>(resource: string, id: string, options?: ShortlinksRequestOptions & { query?: ShortlinksQueryParams }): Promise<T | null>;
  /** Create one entity. Retry-safe via an auto `Idempotency-Key`. */
  create<T = unknown>(resource: string, body: unknown, options?: ShortlinksRequestOptions & { query?: ShortlinksQueryParams; idempotencyKey?: string }): Promise<T>;
  /** Update one entity by id (PATCH by default). */
  update<T = unknown>(resource: string, id: string, patch: unknown, options?: ShortlinksRequestOptions & { query?: ShortlinksQueryParams; method?: "PATCH" | "PUT"; idempotencyKey?: string }): Promise<T>;
  /** Delete one entity by id. Resolves for 2xx and 404 (already gone). */
  delete(resource: string, id: string, options?: ShortlinksRequestOptions & { query?: ShortlinksQueryParams }): Promise<void>;
}

/** Transport-construction overrides forwarded to the contracts resolver (tests). */
export interface ShortlinksTransportOverrides {
  /** Override fetch (tests). Defaults to global fetch. */
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
  /** Per-request timeout in ms. Default 30000. */
  timeoutMs?: number;
  /** Default retry policy for all requests. Pass `false` to disable. */
  retry?: ShortlinksRetryOptions | false;
  /** Injectable sleep (tests). Defaults to a real timer. */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Tier-1 credential inputs, e.g. from `--api-key` / `--profile` flags. */
  credentials?: ShortlinksCredentialChainOptions;
}

/** Which tier of the credential chain supplied a key. */
export type ShortlinksCredentialTier =
  | "argument"
  | "override"
  | "pointer"
  | "profile"
  | "keychain"
  | "disk"
  | "env";

/**
 * Lifecycle lookup for a presented API key (`@hasna/contracts/auth`'s
 * `KeyStatusResolver` spelled locally so the published `.d.ts` stays
 * self-contained, hasna/apps#1782).
 */
export type ShortlinksKeyStatusResolver = (kid: string) =>
  | "active"
  | "revoked"
  | "expired"
  | "unknown"
  | Promise<"active" | "revoked" | "expired" | "unknown">;

/** A credential resolved from one tier of the chain. `apiKey` is never a public value. */
export interface ShortlinksResolvedCredential {
  readonly apiKey: string;
  readonly tier: ShortlinksCredentialTier;
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

/** Where a client reads and writes. There is one: the authenticated service API. */
export type ShortlinksClientTransportKind = "http";

/** The transport decision, with every source named and no key value in it. */
export interface ShortlinksClientTransportResolution {
  /** Where the client should read/write from. */
  transport: ShortlinksClientTransportKind;
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
  apiKeyTier: ShortlinksCredentialTier;
  /** Kept for diagnostic shape compatibility; a successful resolution is never misconfigured. */
  misconfigured: boolean;
  /** Human-readable warning, or null. Never contains secret values. */
  warning: string | null;
}
