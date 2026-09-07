// The @hasna/contracts client shapes that @hasna/instructions PUBLISHES.
//
// WHY THIS FILE EXISTS. `@hasna/contracts` is a BUILD-TIME dependency of this
// package: `bun build --target bun` inlines the resolver into every bundle, so
// `dist/*.js` imports node builtins only and a consumer installs nothing extra.
// The declarations `tsc` emits are not bundled, though — they keep every import
// the source wrote. Moving `import ... from "@hasna/contracts/client"` onto the
// emitted public type entry would put a live `@hasna/contracts` import in
// `dist/**/*.d.ts` and TS consumers — who install this package's runtime
// dependencies and not its devDependencies — would hit TS2307 "Cannot find
// module '@hasna/contracts/client'" (hasna/apps#1782, the secrets wave).
//
// WHAT THIS IS NOT. It is NOT a second copy of the resolver. There is no logic
// here — no tier, no Keychain read, no URL ladder, not one runtime statement.
// The resolver still lives in @hasna/contracts and only there; this file is the
// SPELLING of the shapes that cross this package's published boundary. Every
// one of them is checked against the real @hasna/contracts declarations at
// compile time by the assignments at the seam (config-store.ts, transport
// resolver) and by client-types.test.ts — a shape that drifts fails the build,
// it does not silently publish a lie.
//
// Nothing in here imports anything. That is the invariant: this module is the
// leaf of the published declaration graph.

/** Which tier of the credential chain supplied a key (@hasna/contracts `CredentialTier`). */
export type InstructionsCredentialTier =
  | "argument"
  | "override"
  | "pointer"
  | "profile"
  | "keychain"
  | "disk"
  | "env";

/** A resolved client transport: authority + credential SOURCE, never a value (@hasna/contracts `ClientTransportResolution`). */
export interface InstructionsClientTransportResolution {
  /** Where the client should read/write from. */
  transport: string;
  /** What selected the transport (an env key NAME, a Keychain reference, a file PATH, or `"default"`). */
  transportSource: string;
  /** `<origin>/v1` base for the server API. */
  baseUrl: string;
  /** WHERE the API URL came from: an env key NAME, a Keychain reference, a file PATH, or `"default"`. */
  apiUrlSource: string | null;
  /** Whether an API key is present (value never exposed). */
  apiKeyPresent: boolean;
  /** WHERE the API key came from: an env key NAME or an absolute file path. Never the value. */
  apiKeySource: string | null;
  /** Which tier of the credential chain supplied the key. */
  apiKeyTier: InstructionsCredentialTier;
  /** Diagnostic shape compatibility: a successful resolution is never misconfigured. */
  misconfigured: boolean;
  /** Human-readable warning, or null. Never contains secret values. */
  warning: string | null;
}

/**
 * An environment as the client resolver reads it.
 */
export type InstructionsClientEnv = Record<string, string | undefined>;

/** The Keychain-tier controls (@hasna/contracts `KeychainTierOptions`). */
export interface InstructionsKeychainOptions {
  /**
   * Whether the Keychain is consulted for a caller-built env object. Ambient
   * for `process.env`; `true` turns the tier on for a caller-built env; `false`
   * turns it off even for the live environment. Injecting `run` implies `true`.
   */
  enabled?: boolean;
  /** Defaults to `process.platform`; the tier exists only on `"darwin"`. */
  platform?: string;
  /** The machine's host name (`hostname -s`). Defaults to `os.hostname()`. */
  hostname?: () => string;
  /** The `security` runner. Defaults to spawning `/usr/bin/security` by argv. */
  run?: (argv: readonly string[]) => { status: number | null; stdout: string; stderr: string };
}

/** Tier-1 credential inputs and Keychain-tier controls (@hasna/contracts `CredentialChainOptions`). */
export interface InstructionsCredentialChainOptions {
  /** Tier 1: an explicit key, e.g. from `--api-key`. */
  apiKey?: string;
  /** Tier 1: an explicit profile name, e.g. from `--profile`. Beats `HASNA_PROFILE`. */
  profile?: string;
  /** Tier 3: Keychain controls — a fake `security` runner in tests, an opt-out on CI. */
  keychain?: InstructionsKeychainOptions;
}

/** Query params (@hasna/contracts `QueryParams`). */
export type InstructionsQueryParams =
  | URLSearchParams
  | Record<string, string | number | boolean | null | undefined | ReadonlyArray<string | number | boolean>>;

/** Retry policy for transient failures (@hasna/contracts `HasnaRetryOptions`). */
export interface InstructionsRetryOptions {
  /** Max RETRY attempts after the first try. Default 2 (=> up to 3 total tries). */
  retries?: number;
  /** Base backoff in ms for exponential backoff. Default 200. */
  baseDelayMs?: number;
  /** Backoff ceiling in ms. Default 2000. */
  maxDelayMs?: number;
  /** HTTP statuses that trigger a retry. Default 408, 425, 429, 500, 502, 503, 504. */
  retryStatuses?: number[];
}

/** Per-request transport options the store forwards (@hasna/contracts `HasnaRequestOptions`). */
export interface InstructionsRequestOptions {
  /** Query string params appended to the URL. */
  query?: InstructionsQueryParams;
  /** Idempotency key sent as `Idempotency-Key` (retry-safe POST). */
  idempotencyKey?: string;
  /** Override the transport timeout for this call (ms). */
  timeoutMs?: number;
  /** Extra headers merged into this call. */
  headers?: Record<string, string>;
  /** Override or disable retry. `false` disables retries. */
  retry?: InstructionsRetryOptions | false;
  /** Caller abort signal, combined with the internal timeout. */
  signal?: AbortSignal;
}

/** The authenticated HTTP transport surface the store dials (@hasna/contracts `HasnaHttpTransport`). */
export interface InstructionsStorageTransport {
  readonly baseUrl: string;
  request<T = unknown>(method: string, path: string, body?: unknown, opts?: InstructionsRequestOptions): Promise<T>;
  get<T = unknown>(path: string, opts?: InstructionsRequestOptions): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, opts?: InstructionsRequestOptions): Promise<T>;
  put<T = unknown>(path: string, body?: unknown, opts?: InstructionsRequestOptions): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown, opts?: InstructionsRequestOptions): Promise<T>;
  del<T = unknown>(path: string, body?: unknown, opts?: InstructionsRequestOptions): Promise<T>;
}

/** Response of a storage list() call (@hasna/contracts `StorageListResult`). */
export interface InstructionsStorageListResult<T> {
  items: T[];
  /** Total count when the server reports one (`total`/`count`), else null. */
  total: number | null;
  /** Opaque pagination cursor when the server reports one, else null. */
  cursor: string | null;
  /** The full parsed response body (envelope preserved). */
  raw: unknown;
}

/** The resolved storage client the store wraps (@hasna/contracts `HasnaStorageClient`). */
export interface InstructionsStorageClient {
  /** App slug this client targets. */
  readonly name: string;
  /** `<origin>/v1` base URL. */
  readonly baseUrl: string;
  /** The underlying HTTP transport (escape hatch for non-CRUD routes). */
  readonly transport: InstructionsStorageTransport;

  /** List a collection. Returns extracted `items` plus the raw envelope. */
  list<T = unknown>(resource: string, options?: InstructionsRequestOptions & { query?: InstructionsQueryParams }): Promise<InstructionsStorageListResult<T>>;
  /** Fetch one entity by id. Returns `null` on 404. */
  get<T = unknown>(resource: string, id: string, options?: InstructionsRequestOptions): Promise<T | null>;
  /** Create one entity. Retry-safe via an auto `Idempotency-Key`. */
  create<T = unknown>(resource: string, body: unknown, options?: InstructionsRequestOptions & { idempotencyKey?: string }): Promise<T>;
  /** Update one entity by id (PATCH by default). */
  update<T = unknown>(resource: string, id: string, patch: unknown, options?: InstructionsRequestOptions & { method?: "PATCH" | "PUT"; idempotencyKey?: string }): Promise<T>;
  /** Delete one entity by id. Resolves for 2xx and 404 (already gone). */
  delete(resource: string, id: string, options?: InstructionsRequestOptions): Promise<void>;
}