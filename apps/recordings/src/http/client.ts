// HTTP storage client for the Hasna Service Contract v1.
//
// The shared client seam (`resolveStorageClient` and the storage-client types)
// is imported from `@hasna/contracts/client` rather than vendored: a fork does
// not receive credential-resolution fixes, so the credential chain (argument,
// deliberate override, profile, Keychain, disk, then the canonical env name)
// is the maintained code path. This file keeps the app's local transport
// plumbing (createHttpTransport / createStorageClient) used by tests and the
// ./storage public surface, and adapts the surfaces onto the seam:
//
//   - resolveRecordingsTransport — the transport decision ("is this run hosted
//     or the deliberate unhosted opt-in?") with everything recorded for a
//     diagnostic but nothing secret in it.
//   - getRecordingsTransportStatus — the non-throwing variant for
//     diagnostics (src/lib/persistence-probe.ts).
//   - resolveRecordingsCloudClient — the hosted store client itself, resolved
//     fresh per call; the transport re-resolves the credential on every
//     request, so a rotation heals a long-lived MCP server without a restart.
//
// THE CLIENT HAS EXACTLY TWO STORES: `sqlite` (an on-box file) and `http` (the
// server's `<API_URL>/v1` API with a bearer key). It NEVER opens Postgres — the
// server's internal storage engine is the server's business and is invisible
// here. Which store is active is decided by the @hasna/contracts resolver (an
// explicit `--api-key`/`--profile`, the deliberate pointers
// `HASNA_RECORDINGS_API_KEY_OVERRIDE` / `HASNA_RECORDINGS_API_KEY_REF` /
// `HASNA_PROFILE`, the macOS Keychain item
// `hasna.credentials.recordings.api-key`, `~/.hasna/recordings/config/credentials`
// at 0400/0600, then `HASNA_RECORDINGS_API_KEY`), with the authority following
// `HASNA_RECORDINGS_API_URL`, the Keychain `api-url` item, the credentials
// file, and finally the fleet gateway `https://api.hasna.com/recordings` (the
// client appends `/v1`). The unprefixed `RECORDINGS_API_KEY` keeps its
// older meaning — the OpenAI transcription-key override (src/lib/config.ts,
// credential-seam waiver) — and is carved out of the resolver environment
// (src/lib/local-opt-in.ts), so it can never authenticate as a Hasna
// credential. Retired locations — `~/.hasna/fleet-env`, `~/.hasna/cloud`,
// `~/.config/hasna`, `$XDG_CONFIG_HOME` — are inputs nowhere, and no
// `*_MODE` / `*_STORAGE_MODE` / `*_CLIENT_STORE` variable is read: the
// transport is decided by what RESOLVES, never by a mode word.
//
// FAIL LOUD. Hosted mode with no credential throws (CLI/MCP surface: non-zero
// exit, no SQLite, no local-fallback event). The on-box SQLite file is
// reachable ONLY through the deliberate unhosted opt-in
// `HASNA_RECORDINGS_LOCAL=1` (alias `RECORDINGS_LOCAL=1`), which is answered
// BEFORE the resolver runs so an opted-in run reads neither the Keychain nor
// any credential file.
//
// SAFETY: never logs, returns, or embeds the API key value.

import {
  clientTransportEnvKeys,
  resolveClientTransport,
  type CredentialTier,
} from "@hasna/contracts/client";
import {
  resolveStorageClient,
  type HasnaStorageClient,
} from "@hasna/contracts/client/storage";
import {
  RECORDINGS_LOCAL_OPT_IN_ENV_KEYS,
  isRecordingsLocalOptIn,
  recordingsResolverInputs,
  selectsRecordingsLocalStore,
} from "../lib/local-opt-in.js";

export { RECORDINGS_LOCAL_OPT_IN_ENV_KEYS, isRecordingsLocalOptIn };

export type Env = Record<string, string | undefined>;

export function toV1BaseUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API URL must use http or https.");
  }
  let path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/v1")) path = path.slice(0, -"/v1".length);
  url.pathname = `${path}/v1`;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

// ── The @hasna/contracts shapes this package PUBLISHES ─────────────────────
//
// `@hasna/contracts` is a build-time inlining dependency of the CLI and MCP
// bundles, and the runtime dependency of the serve bundle and the public
// declaration graph. The declarations `tsc` emits are not bundled, though —
// they keep every import the source wrote, so a published `*.d.ts` that
// reached into `@hasna/contracts/client` would import a module the consumer's
// resolution may not have. The shapes below are the crossing types spelled
// locally (the #1782 pattern): no imports, no logic, and each one checked
// against the real @hasna/contracts declaration at compile time by
// `src/__tests__/credential-resolution.test.ts` and by the assignments at the
// seam in this file — a shape that drifts fails the build, it does not
// silently publish a lie.

/** An account/host selection for the Keychain tier; injected by tests. */
export interface RecordsKeychainCommandResult {
  /** Exit status; null when the tool could not be started or was killed. */
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `/usr/bin/security` with the given argv — no shell. Injected by tests. */
export type RecordsKeychainCommandRunner = (
  argv: readonly string[],
) => RecordsKeychainCommandResult;

/** Keychain-tier controls. Every field is optional; production callers pass nothing. */
export interface RecordsKeychainTierOptions {
  /** Whether the Keychain is consulted for a caller-built env object. The tier is AMBIENT. */
  enabled?: boolean;
  /** Defaults to `process.platform`; the tier exists only on `"darwin"`. */
  platform?: string;
  /** The machine's host name (label before the first dot), used when `HASNA_STATION` is unset. */
  hostname?: () => string;
  /** The `security` runner. Defaults to spawning `/usr/bin/security` by argv. */
  run?: RecordsKeychainCommandRunner;
}

/** Tier-1 credential inputs (`--api-key` / `--profile`) plus the Keychain-tier seam. */
export interface RecordsCredentialChainOptions {
  /** Tier 1: an explicit key, e.g. from `--api-key`. */
  apiKey?: string;
  /** Tier 1: an explicit profile name, e.g. from `--profile`. Beats `HASNA_PROFILE`. */
  profile?: string;
  /** Tier 3: Keychain controls — a fake `security` runner in tests, an opt-out on CI. */
  keychain?: RecordsKeychainTierOptions;
}

/** Which tier of the credential chain supplied a key. */
export type RecordsCredentialTier =
  | "argument"
  | "override"
  | "pointer"
  | "profile"
  | "keychain"
  | "disk"
  | "env";

/** The transport decision, with every source named and no key value in it. */
export interface RecordsAuthorityResolution {
  /** Where the client should read/write from. Always `"http"` in a resolution. */
  transport: "http";
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
  apiKeyTier: RecordsCredentialTier;
  /** Kept for diagnostic shape compatibility; a successful resolution is never misconfigured. */
  misconfigured: boolean;
  /** Human-readable warning, or null. Never contains secret values. */
  warning: string | null;
}

/** Tier-1 credential inputs and Keychain-tier controls, forwarded verbatim. */
export interface RecordsClientResolveOptions {
  /** `--api-key` / `--profile`, and the injectable `security` runner tests use. */
  credentials?: RecordsCredentialChainOptions;
}

export type RecordsClientTransport = "sqlite" | "http";

export interface RecordsTransportResolution {
  /** Canonical transport the environment resolved to (`sqlite` | `http`). */
  transport: RecordsClientTransport;
  /** False only for the deliberate unhosted opt-in. */
  selected: boolean;
  /**
   * What selected the transport: `"local-opt-in"` for the deliberate unhosted
   * store, else `"<api key source>+<api url source>"` as the contracts resolver
   * reported them (env key NAMES, a Keychain item reference, a file path, or
   * `"default"` for the fleet gateway). Never a credential value.
   */
  source: string;
  /** The contracts resolution for the http transport; null for sqlite. It never carries the key. */
  authority: RecordsAuthorityResolution | null;
}

/**
 * The `{ items, total, cursor, raw }` shape the shared storage client returns
 * from a `list()`.
 */
export interface RecordsListResult<T> {
  items: T[];
  total: number | null;
  cursor: string | null;
  raw: unknown;
}

/** The hosted store client, spelled locally so the public surface stays boundary-clean. */
export interface RecordsCloudClient {
  readonly name: string;
  /** `<origin>/v1` base URL. */
  readonly baseUrl: string;
  /** The underlying HTTP transport (escape hatch for non-CRUD routes). */
  readonly transport: HttpTransport;

  list<T = unknown>(
    resource: string,
    options?: {
      query?: QueryParams;
      timeoutMs?: number;
      headers?: Record<string, string>;
      signal?: AbortSignal;
    },
  ): Promise<RecordsListResult<T>>;
  /** Fetch one entity by id. Returns `null` on 404. */
  get<T = unknown>(
    resource: string,
    id: string,
    options?: {
      query?: QueryParams;
      timeoutMs?: number;
      headers?: Record<string, string>;
      signal?: AbortSignal;
    },
  ): Promise<T | null>;
  /** Create one entity. Retry-safe via an auto `Idempotency-Key`. */
  create<T = unknown>(
    resource: string,
    body: unknown,
    options?: {
      query?: QueryParams;
      timeoutMs?: number;
      headers?: Record<string, string>;
      signal?: AbortSignal;
      idempotencyKey?: string;
    },
  ): Promise<T>;
  /** Update one entity by id (PATCH by default). */
  update<T = unknown>(
    resource: string,
    id: string,
    patch: unknown,
    options?: {
      query?: QueryParams;
      timeoutMs?: number;
      headers?: Record<string, string>;
      signal?: AbortSignal;
      method?: "PATCH" | "PUT";
      idempotencyKey?: string;
    },
  ): Promise<T>;
  /** Delete one entity by id. Resolves for 2xx and 404 (already gone). */
  delete(
    resource: string,
    id: string,
    options?: {
      query?: QueryParams;
      timeoutMs?: number;
      headers?: Record<string, string>;
      signal?: AbortSignal;
    },
  ): Promise<void>;
}

// ── Local transport plumbing (unchanged public surface) ────────────────────

export class HasnaHttpError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  constructor(method: string, path: string, status: number, body: unknown) {
    super(`Hasna request failed: ${method} ${path} -> ${status}`);
    this.name = "HasnaHttpError";
    this.status = status;
    this.method = method;
    this.path = path;
    this.body = body;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type QueryParams = Record<string, string | number | boolean | null | undefined | ReadonlyArray<string | number | boolean>>;

export interface RequestOptions {
  query?: QueryParams;
  idempotencyKey?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  retries?: number;
}

export interface HttpTransport {
  readonly baseUrl: string;
  request<T = unknown>(method: string, path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  get<T = unknown>(path: string, opts?: RequestOptions): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  put<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  del<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
}

export interface TransportOptions {
  name: string;
  baseUrl: string;
  apiKey: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}

function appendQuery(path: string, query?: QueryParams): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) params.append(key, String(v));
    else params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}${path.includes("?") ? "&" : "?"}${qs}` : path;
}

const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const IDEMPOTENT = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createHttpTransport(options: TransportOptions): HttpTransport {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const base = options.baseUrl.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 30_000;
  const sleep = options.sleepImpl ?? defaultSleep;

  async function once<T>(method: string, rel: string, url: string, body: unknown, opts: RequestOptions): Promise<{ ok: true; value: T } | { ok: false; retryable: boolean; error: Error }> {
    const headers: Record<string, string> = {
      "x-api-key": options.apiKey,
      Authorization: `Bearer ${options.apiKey}`,
      Accept: "application/json",
      ...(opts.headers ?? {}),
    };
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? timeoutMs);
    init.signal = controller.signal;
    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (opts.signal?.aborted) return { ok: false, retryable: false, error: err };
      return { ok: false, retryable: true, error: err };
    } finally {
      clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
    }
    const text = await response.text();
    let parsed: unknown = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!response.ok) {
      return { ok: false, retryable: RETRY_STATUSES.has(response.status), error: new HasnaHttpError(method, rel, response.status, parsed) };
    }
    return { ok: true, value: parsed as T };
  }

  async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
    const upper = method.toUpperCase();
    const rel = appendQuery(path.startsWith("/") ? path : `/${path}`, opts.query);
    const url = `${base}${rel}`;
    const methodRetryable = IDEMPOTENT.has(upper) || Boolean(opts.idempotencyKey);
    const maxRetries = opts.retries ?? 2;
    const maxAttempts = methodRetryable ? maxRetries + 1 : 1;
    let last: { error: Error } | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await once<T>(upper, rel, url, body, opts);
      if (result.ok) return result.value;
      last = result;
      const canRetry = methodRetryable && result.retryable && attempt < maxAttempts;
      if (!canRetry) break;
      const backoff = Math.min(2_000, 200 * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * (backoff / 2 + 1));
      await sleep(backoff + jitter);
    }
    if (last === null) throw new Error(`Request to ${rel} completed without a result`);
    throw last.error;
  }

  return {
    baseUrl: base,
    request,
    get: (path, opts) => request("GET", path, undefined, opts),
    post: (path, body, opts) => request("POST", path, body, opts),
    patch: (path, body, opts) => request("PATCH", path, body, opts),
    put: (path, body, opts) => request("PUT", path, body, opts),
    del: (path, body, opts) => request("DELETE", path, body, opts),
  };
}

function newIdempotencyKey(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `idmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export interface StorageClient {
  readonly name: string;
  readonly baseUrl: string;
  readonly transport: HttpTransport;
  list<T = unknown>(resource: string, query?: QueryParams): Promise<{ items: T[]; raw: unknown }>;
  get<T = unknown>(resource: string, id: string): Promise<T | null>;
  create<T = unknown>(resource: string, body: unknown, idempotencyKey?: string): Promise<T>;
  update<T = unknown>(resource: string, id: string, patch: unknown, method?: "PATCH" | "PUT"): Promise<T>;
  delete(resource: string, id: string): Promise<void>;
}

function extractItems<T>(raw: unknown, extraKeys: string[] = []): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of [...extraKeys, "items", "data", "results", "rows", "records"]) {
      if (Array.isArray(obj[key])) return obj[key] as T[];
    }
  }
  return [];
}

export function createStorageClient(name: string, transport: HttpTransport): StorageClient {
  const rp = (r: string) => `/${r.replace(/^\/+|\/+$/g, "")}`;
  const ep = (r: string, id: string) => `${rp(r)}/${encodeURIComponent(String(id))}`;
  return {
    name,
    baseUrl: transport.baseUrl,
    transport,
    async list<T = unknown>(resource: string, query?: QueryParams) {
      const raw = await transport.get<unknown>(rp(resource), { query });
      return { items: extractItems<T>(raw, [resource]), raw };
    },
    async get<T = unknown>(resource: string, id: string) {
      try {
        return await transport.get<T>(ep(resource, id));
      } catch (error) {
        if (error instanceof HasnaHttpError && error.status === 404) return null;
        throw error;
      }
    },
    async create<T = unknown>(resource: string, body: unknown, idempotencyKey?: string) {
      return transport.post<T>(rp(resource), body, { idempotencyKey: idempotencyKey ?? newIdempotencyKey() });
    },
    async update<T = unknown>(resource: string, id: string, patch: unknown, method: "PATCH" | "PUT" = "PATCH") {
      const call = method === "PUT" ? transport.put<T> : transport.patch<T>;
      return call(ep(resource, id), patch);
    },
    async delete(resource: string, id: string) {
      try {
        await transport.del(ep(resource, id));
      } catch (error) {
        if (error instanceof HasnaHttpError && error.status === 404) return;
        throw error;
      }
    },
  };
}

// ── The resolver adapter ────────────────────────────────────────────────────

/**
 * Re-throw a `@hasna/contracts` resolution failure as the recordings
 * fail-closed diagnostic, preserving the resolver's message (which names every
 * tier it consulted) behind the stable `REMOTE_API_*` code callers match on.
 * Nothing here ever returns a client or a local store: every arm throws.
 */
export function throwRecordingsAuthorityFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  if (name === "CredentialResolutionError" || name === "CredentialFileUnsafeError") {
    throw new Error(
      `REMOTE_API_CREDENTIAL_INVALID: ${message} There is no local fallback: ` +
        "local SQLite is opt-in only (HASNA_RECORDINGS_LOCAL=1) and is disabled by default — failing closed",
      { cause: error },
    );
  }
  if (/no API key could be resolved/.test(message)) {
    if (/is not set and no API key could be resolved/.test(message)) {
      throw new Error(
        "REMOTE_API_CONFIG_MISSING: no Recordings credential resolved from the Keychain item " +
          `hasna.credentials.recordings.api-key, ~/.hasna/recordings/config/credentials, or HASNA_RECORDINGS_API_KEY. ${message} ` +
          "There is no local fallback: local SQLite is opt-in only (HASNA_RECORDINGS_LOCAL=1, alias RECORDINGS_LOCAL=1) " +
          "and is disabled by default — failing closed instead of serving the local store",
        { cause: error },
      );
    }
    throw new Error(
      "REMOTE_API_KEY_MISSING: remote Recordings storage requires HASNA_RECORDINGS_API_KEY, the Keychain item " +
        `hasna.credentials.recordings.api-key, or ~/.hasna/recordings/config/credentials. ${message} ` +
        "There is no local fallback: local SQLite is opt-in only (HASNA_RECORDINGS_LOCAL=1) and is disabled by default — failing closed",
      { cause: error },
    );
  }
  throw new Error(
    `REMOTE_API_URL_INVALID: ${message} local SQLite fallback is disabled`,
    { cause: error },
  );
}

function toRecordsAuthority(resolution: {
  transport: "http";
  transportSource: string;
  baseUrl: string;
  apiUrlSource: string | null;
  apiKeyPresent: boolean;
  apiKeySource: string | null;
  apiKeyTier: CredentialTier;
  misconfigured: boolean;
  warning: string | null;
}): RecordsAuthorityResolution {
  return {
    transport: resolution.transport,
    transportSource: resolution.transportSource,
    baseUrl: resolution.baseUrl,
    apiUrlSource: resolution.apiUrlSource,
    apiKeyPresent: resolution.apiKeyPresent,
    apiKeySource: resolution.apiKeySource,
    apiKeyTier: resolution.apiKeyTier,
    misconfigured: resolution.misconfigured,
    warning: resolution.warning,
  };
}

/**
 * Resolve the recordings transport. The deliberate unhosted opt-in is answered
 * first and WITHOUT consulting the resolver; otherwise `@hasna/contracts`
 * resolves the credential and the authority, and any failure to do so is a
 * throw — the client never defaults to the on-box SQLite file (owner ruling
 * 2026-09-04, hasna/apps#1720).
 */
export function resolveRecordingsTransport(
  env: Env = process.env,
  options: RecordsClientResolveOptions = {},
): RecordsTransportResolution {
  if (selectsRecordingsLocalStore(env)) {
    return { transport: "sqlite", selected: false, source: "local-opt-in", authority: null };
  }
  // Normalising blanks (and carving the unprefixed names) hands the resolver a
  // copy, and a copy is not the ambient environment its Keychain tier gates on
  // — so the gate travels with the env as `keychain.enabled` rather than being
  // silently lost (see `recordingsResolverInputs`).
  const resolverInputs = recordingsResolverInputs(env, options.credentials);
  let resolution: ReturnType<typeof resolveClientTransport>;
  try {
    resolution = resolveClientTransport("recordings", resolverInputs.env, {
      credentials: resolverInputs.credentials,
    });
  } catch (error) {
    throwRecordingsAuthorityFailure(error);
  }
  return {
    transport: "http",
    selected: true,
    source: `${resolution.apiKeySource ?? resolution.apiKeyTier}+${resolution.apiUrlSource ?? "default"}`,
    authority: toRecordsAuthority(resolution),
  };
}

/** Non-throwing transport status for diagnostics. Never includes a key value. */
export interface RecordsTransportStatus {
  selected: boolean;
  ok: boolean;
  transport: RecordsClientTransport | "invalid";
  api_url_configured: boolean;
  api_key_configured: boolean;
  api_url_source: string | null;
  api_key_source: string | null;
  api_key_tier: RecordsCredentialTier | null;
  v1_base_url: string | null;
  issues: string[];
  local_fallback: false;
}

/**
 * The status surface `recordings check` renders: every refusal is reported as
 * a status, never thrown. A refused configuration still says WHICH half it
 * has: the flags are read from the environment alone, deliberately — the
 * resolver already refused, so re-running its Keychain and filesystem tiers to
 * decorate a failure would spend the machine's credential stores on a
 * diagnostic, and the message already names every tier it consulted.
 */
export function getRecordingsTransportStatus(
  env: Env = process.env,
  options: RecordsClientResolveOptions = {},
): RecordsTransportStatus {
  let resolution: RecordsTransportResolution;
  try {
    resolution = resolveRecordingsTransport(env, options);
  } catch (error) {
    const issue = error instanceof Error ? error.message : String(error);
    const envKeys = clientTransportEnvKeys("recordings");
    const declared = (keys: readonly string[]) => keys.some((key) => (env[key] ?? "").trim() !== "");
    return {
      selected: true,
      ok: false,
      transport: "invalid",
      api_url_configured: declared(envKeys.apiUrlKeys),
      api_key_configured: declared(envKeys.apiKeyKeys),
      api_url_source: null,
      api_key_source: null,
      api_key_tier: null,
      v1_base_url: null,
      issues: [issue],
      local_fallback: false,
    };
  }
  if (!resolution.selected) {
    return {
      selected: false,
      ok: true,
      transport: resolution.transport,
      api_url_configured: false,
      api_key_configured: false,
      api_url_source: null,
      api_key_source: null,
      api_key_tier: null,
      v1_base_url: null,
      issues: [],
      local_fallback: false,
    };
  }
  const authority = resolution.authority!;
  return {
    selected: true,
    ok: true,
    transport: resolution.transport,
    // The default fleet gateway is a resolved authority, not a configured one:
    // an operator reading this line must be able to tell "I pointed this at a
    // URL" apart from "the gateway default applied".
    api_url_configured: authority.apiUrlSource !== null && authority.apiUrlSource !== "default",
    api_key_configured: authority.apiKeyPresent,
    api_url_source: authority.apiUrlSource,
    api_key_source: authority.apiKeySource,
    api_key_tier: authority.apiKeyTier,
    v1_base_url: authority.baseUrl,
    issues: [],
    local_fallback: false,
  };
}

/**
 * Resolve the hosted storage client, or `null` for the on-box SQLite store,
 * which is reachable ONLY under the deliberate unhosted opt-in. Every other
 * outcome THROWS a `REMOTE_API_*` failure: no credential, an unusable
 * credential file, or a malformed authority. There is no silent local default
 * and no local-fallback event (fail closed, hasna/apps#1720).
 *
 * The returned client's transport re-resolves the credential on every request
 * through the @hasna/contracts chain, so a rotation heals a long-lived MCP
 * server without a restart; only the authority is fixed for the life of the
 * client, so a credential written for one authority is never sent to another.
 */
export function resolveRecordingsCloudClient(
  env: Env = process.env,
  options: RecordsClientResolveOptions = {},
): RecordsCloudClient | null {
  if (selectsRecordingsLocalStore(env)) return null;
  const resolverInputs = recordingsResolverInputs(env, options.credentials);
  let resolved: ReturnType<typeof resolveStorageClient>;
  try {
    resolved = resolveStorageClient("recordings", resolverInputs.env, {
      fetchImpl: (input, init) => globalThis.fetch(input, { ...init, redirect: "manual" }),
      credentials: resolverInputs.credentials,
    });
  } catch (error) {
    throwRecordingsAuthorityFailure(error);
  }
  // The assignment below is the compile-time correspondence check between the
  // shared client's shape and the locally spelled public one (#1782): if the
  // published @hasna/contracts client ever drifts from the boundary spelling,
  // this file stops compiling.
  const client: RecordsCloudClient = resolved.client;
  return client;
}

/**
 * The shared seam entry point, re-exported for consumers of the public storage
 * surface. The seam's own resolution semantics apply (resolve or throw — the
 * recordings surfaces add the local opt-in on top; see
 * {@link resolveRecordingsCloudClient}).
 */
export { resolveStorageClient }; // eslint-disable-line no-restricted-syntax
export type { HasnaStorageClient };