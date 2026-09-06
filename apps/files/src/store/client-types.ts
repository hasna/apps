// The @hasna/contracts client types that @hasna/files PUBLISHES.
//
// WHY THIS FILE EXISTS. `@hasna/contracts` is a BUILD-TIME dependency of this
// package: `bun build --target bun` inlines the resolver into every bundle, so
// `dist/*.js` imports node builtins only and a consumer installs nothing extra.
// The declarations `tsc` emits are not bundled, though — they keep every import
// the source wrote. A TS consumer with only this package's runtime dependencies
// installed must never hit TS2307 "Cannot find module '@hasna/contracts/…'",
// so every contract type that crosses a PUBLISHED boundary of this package is
// spelled HERE, in a leaf that imports nothing, and the seam modules
// (`./client.ts` analogues: `../lib/cloud-storage.ts`, `../store/index.ts`,
// `../sdk/index.ts`) assign the real resolver's values into these spellings.
//
// WHAT THIS IS NOT. It is NOT a vendored resolver. There is no logic here — no
// tier, no Keychain read, no URL ladder, not one runtime statement. The
// resolver still lives in @hasna/contracts and only there. `client-types.test.ts`
// asserts every spelling here is the same type as the real @hasna/contracts
// declaration it mirrors, in BOTH directions, so a shape that drifts fails the
// build rather than silently publishing a lie.
//
// Nothing in here imports anything. That is the invariant: this module is the
// leaf of the published declaration graph.

/** An environment as the client resolver reads it. */
export type ClientEnv = Record<string, string | undefined>;

/** The captured outcome of one `security` invocation. `stdout` IS the secret; it is never logged. */
export interface FilesKeychainCommandResult {
  /** Exit status; null when the tool could not be started or was killed. */
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `/usr/bin/security` with the given argv — no shell. Injected by tests. */
export type FilesKeychainCommandRunner = (argv: readonly string[]) => FilesKeychainCommandResult;

/** Tier-3 (Keychain) controls. Every field is optional; production callers pass nothing. */
export interface FilesKeychainOptions {
  /**
   * Whether the Keychain is consulted for a caller-built env object. The tier
   * is AMBIENT: it runs only when the resolver is handed the live `process.env`
   * (or `keychain.enabled` is explicitly set). `false` turns the tier off even
   * for the live environment (a CI Mac that must never touch a login keychain).
   * Injecting `run` implies `true`.
   */
  enabled?: boolean;
  /** Defaults to `process.platform`; the tier exists only on `"darwin"`. */
  platform?: string;
  /** The machine's host name used as the account when `HASNA_STATION` is unset. */
  hostname?: () => string;
  /** The `security` runner. Defaults to spawning `/usr/bin/security` by argv. */
  run?: FilesKeychainCommandRunner;
}

/**
 * Tier-1 credential inputs and Keychain-tier controls, forwarded verbatim to
 * @hasna/contracts. Spelled locally so the published `.d.ts` stays
 * dependency-free (#1782); `client-types.test.ts` pins the two spellings
 * together in both directions.
 */
export interface FilesCredentialChainOptions {
  /** Tier 1: an explicit key, e.g. from `--api-key`. */
  apiKey?: string;
  /** Tier 1: an explicit profile name, e.g. from `--profile`. */
  profile?: string;
  /** Tier 3: Keychain controls — a fake `security` runner in tests. */
  keychain?: FilesKeychainOptions;
}

/** Which tier of the credential chain supplied a key. */
export type FilesCredentialTier =
  | "argument"
  | "override"
  | "pointer"
  | "profile"
  | "keychain"
  | "disk"
  | "env";

/**
 * A credential resolved from the chain. `apiKey` is non-enumerable and
 * redacted by a custom-inspect hook in the resolver — a runtime property of the
 * value, not something a type can carry. `pointerVaultKey` names the vault item
 * to complete through @hasna/secrets at REQUEST time; a pointer resolution
 * carries no key value at all.
 */
export interface FilesResolvedCredential {
  readonly apiKey: string;
  readonly tier: FilesCredentialTier;
  /** An env key NAME, an absolute file path, or `keychain:<service>@<account>`. Never a value. */
  readonly source: string;
  /** True for tiers an operator sets on purpose; these never fall through. */
  readonly deliberate: boolean;
  readonly pointerVaultKey?: string;
  readonly warning: string | null;
}

/** Query params for a request; nullish values are dropped; arrays repeat the key. */
export type FilesQueryParams =
  | URLSearchParams
  | Record<string, string | number | boolean | null | undefined | ReadonlyArray<string | number | boolean>>;

/** Per-call request options the storage client accepts. */
export interface FilesRequestOptions {
  query?: FilesQueryParams;
  timeoutMs?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** The HTTP transport behind an authenticated client (structural subset). */
export interface FilesHttpTransport {
  readonly baseUrl: string;
  request<T = unknown>(method: string, path: string, body?: unknown, opts?: FilesRequestOptions): Promise<T>;
  get<T = unknown>(path: string, opts?: FilesRequestOptions): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, opts?: FilesRequestOptions): Promise<T>;
  put<T = unknown>(path: string, body?: unknown, opts?: FilesRequestOptions): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown, opts?: FilesRequestOptions): Promise<T>;
  del<T = unknown>(path: string, body?: unknown, opts?: FilesRequestOptions): Promise<T>;
}

/** Retry policy for transient failures (network errors, timeouts, 5xx, 429). */
export interface FilesRetryOptions {
  /** Max RETRY attempts after the first try. Default 2 (=> up to 3 total tries). */
  retries?: number;
  /** Base backoff in ms for exponential backoff. Default 200. */
  baseDelayMs?: number;
  /** Backoff ceiling in ms. Default 2000. */
  maxDelayMs?: number;
  /** HTTP statuses that trigger a retry. Default 408, 425, 429, 500, 502, 503, 504. */
  retryStatuses?: number[];
}

/**
 * Transport overrides the resolver accepts (test injection: fetchImpl, headers,
 * timeout, retry), spelled locally so the published `.d.ts` stays
 * dependency-free (#1782). `client-types.test.ts` pins this spelling to the
 * contracts options it mirrors, in both directions.
 */
export interface FilesStorageOverrides {
  /** Override fetch (tests). Defaults to global fetch. */
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
  /** Per-request timeout in ms. Default 30000. */
  timeoutMs?: number;
  /** Default retry policy for all requests. Pass `false` to disable. */
  retry?: FilesRetryOptions | false;
  /** Injectable sleep (tests). Defaults to a real timer. */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Tier-1 credential inputs and Keychain-tier controls. */
  credentials?: FilesCredentialChainOptions;
}

/** The app storage interface exposed by the authenticated service API (structural subset). */
export interface FilesStorageClient {
  /** App slug this client targets. */
  readonly name: string;
  /** `<origin>/v1` base URL. */
  readonly baseUrl: string;
  /** The underlying HTTP transport (escape hatch for non-CRUD routes). */
  readonly transport: FilesHttpTransport;
  /** List a collection. Returns extracted `items` plus the raw envelope. */
  list<T = unknown>(resource: string, options?: Pick<FilesRequestOptions, "query" | "timeoutMs" | "headers" | "signal">): Promise<{ items: T[]; total: number | null; cursor: string | null; raw: unknown }>;
  /** Fetch one entity by id. Returns `null` on 404. */
  get<T = unknown>(resource: string, id: string, options?: Pick<FilesRequestOptions, "query" | "timeoutMs" | "headers" | "signal">): Promise<T | null>;
  /** Create one entity. */
  create<T = unknown>(resource: string, body: unknown, options?: Pick<FilesRequestOptions, "query" | "timeoutMs" | "headers" | "signal">): Promise<T>;
  /** Update one entity by id (PATCH by default). */
  update<T = unknown>(resource: string, id: string, patch: unknown, options?: Pick<FilesRequestOptions, "timeoutMs" | "headers" | "signal">): Promise<T>;
  /** Delete one entity by id. */
  delete(resource: string, id: string, options?: Pick<FilesRequestOptions, "timeoutMs" | "headers" | "signal">): Promise<void>;
}