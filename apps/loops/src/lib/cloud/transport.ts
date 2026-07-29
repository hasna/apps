// Client-side transport resolver for the Hasna Service Contract v1.
//
// THIS IS THE B2 CORE FIX. Historically, flipping a client to the hosted API
// was a NO-OP: the CLI/MCP still read the local SQLite/db.json store even
// though the flip env vars and a DATABASE_URL were set. A DSN on the client
// does NOT switch the dataset a CLI reads.
//
// This module makes the client actually talk to the server. Given an app name
// and the environment it decides whether reads AND writes should be routed to
// the app's HTTP API (`<API_URL>/v1`, e.g. `https://<app>.<your-deployment-domain>/v1`)
// with the API key, or fall through to the on-box sqlite store. There is no
// built-in hostname default — the API URL must be configured explicitly.
//
// THE CLIENT-FLIP CONTRACT (env vars). For app `<NAME>` = envToken(name):
//
//   Store seam pin (optional; unset resolves from the API vars):
//     HASNA_<NAME>_STORAGE_MODE = sqlite | http
//   API base URL (`/v1` is appended automatically):
//     HASNA_<NAME>_API_URL = https://<app>.<your-deployment-domain>
//   API key (bearer / x-api-key):
//     HASNA_<NAME>_API_KEY = hasna_<app>_...
//
// DECISION: transport is `http` only when both the API URL and API key are
// present. Partial remote configuration throws.
//
// SAFETY: this module never returns, logs, or embeds the API key value. Callers
// receive only presence flags and env-key names.

import { normalizeStorageMode, envToken, type Env } from "./mode.js";
import type { StorageMode } from "./mode.js";

export interface ClientTransportEnvKeys {
  /** Mode keys, in precedence order. */
  modeKeys: string[];
  /** API base-URL keys, in precedence order. */
  apiUrlKeys: string[];
  /** API-key keys, in precedence order. */
  apiKeyKeys: string[];
}

/** Resolve the canonical client-flip env-key spec for an app. */
export function clientTransportEnvKeys(name: string): ClientTransportEnvKeys {
  const token = envToken(name);
  return {
    modeKeys: [`HASNA_${token}_STORAGE_MODE`],
    apiUrlKeys: [`HASNA_${token}_API_URL`],
    apiKeyKeys: [`HASNA_${token}_API_KEY`],
  };
}

function firstEnv(env: Env, keys: readonly string[]): { key: string; value: string } | null {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return { key, value };
  }
  return null;
}

/** Normalize a base URL to `<origin>/v1` (dropping any trailing slash or existing /v1). */
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

export type ClientTransportKind = "sqlite" | "http";

export interface ClientTransportResolution {
  /** Where the client should read/write from. */
  transport: ClientTransportKind;
  /** Resolved client store seam value. */
  mode: StorageMode;
  /** Env key the mode was read from, or `"default"`. */
  modeSource: string;
  /** `<origin>/v1` base for the hosted API when transport is http, else null. */
  baseUrl: string | null;
  /** Env key the API URL came from, `"default"` (host template), or null. */
  apiUrlSource: string | null;
  /** Whether an API key is present (value never exposed). */
  apiKeyPresent: boolean;
  /** Env key the API key came from, or null. */
  apiKeySource: string | null;
}

/**
 * Resolve how a client should reach an app's data given the environment.
 *
 * The only mode key is `HASNA_<NAME>_STORAGE_MODE`; unset means `local`.
 */
export function resolveClientTransport(name: string, env: Env = process.env): ClientTransportResolution {
  const keys = clientTransportEnvKeys(name);
  const modeHit = firstEnv(env, keys.modeKeys);
  const urlHit = firstEnv(env, keys.apiUrlKeys);
  const keyHit = firstEnv(env, keys.apiKeyKeys);

  let mode: StorageMode = "sqlite";
  let modeSource = "default";

  if (modeHit) {
    mode = normalizeStorageMode(modeHit.value).mode;
    modeSource = modeHit.key;
  }

  // The sqlite pin never routes to the network, regardless of URL/key presence.
  if (mode === "sqlite") {
    return {
      transport: "sqlite",
      mode,
      modeSource,
      baseUrl: null,
      apiUrlSource: null,
      apiKeyPresent: Boolean(keyHit),
      apiKeySource: keyHit ? keyHit.key : null,
    };
  }

  if (!urlHit || !keyHit) {
    throw new Error(
      `${modeSource}=${mode} requires both ${keys.apiUrlKeys[0]} and ${keys.apiKeyKeys[0]}.`,
    );
  }

  const apiUrlSource = urlHit.key;
  const baseUrl = toV1BaseUrl(urlHit.value);

  return {
    transport: "http",
    mode,
    modeSource,
    baseUrl,
    apiUrlSource,
    apiKeyPresent: true,
    apiKeySource: keyHit.key,
  };
}

/** Thrown when a cloud HTTP request returns a non-2xx status. */
export class HasnaHttpError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  constructor(method: string, path: string, status: number, body: unknown) {
    super(`Hasna cloud request failed: ${method} ${path} -> ${status}`);
    this.name = "HasnaHttpError";
    this.status = status;
    this.method = method;
    this.path = path;
    this.body = body;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Query params for a request. Nullish values are dropped; arrays repeat the key. */
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

const DEFAULT_RETRY_STATUSES = [408, 425, 429, 500, 502, 503, 504] as const;
/** Methods that are idempotent by definition and always safe to retry. */
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);

export interface HasnaHttpTransportOptions {
  /** App slug (for error context / default host). */
  name: string;
  /** `<origin>/v1` base. Usually from `resolveClientTransport().baseUrl`. */
  baseUrl: string;
  /** The API key (secret). Sent as both `x-api-key` and `Authorization: Bearer`. */
  apiKey: string;
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
export function appendQuery(path: string, query?: QueryParams): string {
  if (!query) return path;
  const params = query instanceof URLSearchParams ? query : new URLSearchParams();
  if (!(query instanceof URLSearchParams)) {
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) {
        for (const v of value) params.append(key, String(v));
      } else {
        params.append(key, String(value));
      }
    }
  }
  const qs = params.toString();
  if (!qs) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${qs}`;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Build an authenticated HTTP transport for an app's cloud `/v1` API. Sends the
 * API key on every request as BOTH `x-api-key` and `Authorization: Bearer`
 * (serve apps accept either), returns parsed JSON, times out, and retries
 * transient failures with exponential backoff + jitter. Never logs the key.
 *
 * Retry safety: idempotent methods (GET/HEAD/PUT/DELETE/OPTIONS) are always
 * retried on transient failure; POST/PATCH are retried ONLY when an
 * `Idempotency-Key` is supplied, so replays can't create duplicates.
 */
export function createHasnaHttpTransport(options: HasnaHttpTransportOptions): HasnaHttpTransport {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const base = options.baseUrl.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 30_000;
  const sleep = options.sleepImpl ?? defaultSleep;
  const defaultRetry = options.retry;

  function resolveRetry(callRetry: HasnaRequestOptions["retry"]): Required<HasnaRetryOptions> | null {
    const chosen = callRetry !== undefined ? callRetry : defaultRetry;
    if (chosen === false) return null;
    const r = chosen ?? {};
    return {
      retries: r.retries ?? 2,
      baseDelayMs: r.baseDelayMs ?? 200,
      maxDelayMs: r.maxDelayMs ?? 2_000,
      retryStatuses: r.retryStatuses ?? [...DEFAULT_RETRY_STATUSES],
    };
  }

  async function once<T>(
    method: string,
    rel: string,
    url: string,
    body: unknown,
    opts: HasnaRequestOptions,
  ): Promise<{ ok: true; value: T } | { ok: false; retryable: boolean; error: Error }> {
    const headers: Record<string, string> = {
      "x-api-key": options.apiKey,
      Authorization: `Bearer ${options.apiKey}`,
      Accept: "application/json",
      ...(options.headers ?? {}),
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
      // A caller-initiated abort is a cancellation, not a transient failure —
      // propagate it immediately instead of retrying. Our own timeout abort and
      // ordinary network errors ARE transient and retryable.
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
      const retry = resolveRetry(opts.retry);
      const retryable = retry ? retry.retryStatuses.includes(response.status) : false;
      return { ok: false, retryable, error: new HasnaHttpError(method, rel, response.status, parsed) };
    }
    return { ok: true, value: parsed as T };
  }

  async function request<T>(method: string, path: string, body?: unknown, opts: HasnaRequestOptions = {}): Promise<T> {
    const upper = method.toUpperCase();
    const rel = appendQuery(path.startsWith("/") ? path : `/${path}`, opts.query);
    const url = `${base}${rel}`;
    const retry = resolveRetry(opts.retry);
    const methodRetryable = IDEMPOTENT_METHODS.has(upper) || Boolean(opts.idempotencyKey);
    const maxAttempts = retry && methodRetryable ? retry.retries + 1 : 1;

    let last: { retryable: boolean; error: Error } | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await once<T>(upper, rel, url, body, opts);
      if (result.ok) return result.value;
      last = result;
      const canRetry = retry !== null && methodRetryable && result.retryable && attempt < maxAttempts;
      if (!canRetry) break;
      const backoff = Math.min(retry!.maxDelayMs, retry!.baseDelayMs * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * (backoff / 2 + 1));
      await sleep(backoff + jitter);
    }
    throw last!.error;
  }

  return {
    baseUrl: base,
    request,
    get: (path, opts) => request("GET", path, undefined, opts),
    post: (path, body, opts) => request("POST", path, body, opts),
    put: (path, body, opts) => request("PUT", path, body, opts),
    patch: (path, body, opts) => request("PATCH", path, body, opts),
    del: (path, body, opts) => request("DELETE", path, body, opts),
  };
}

/**
 * Convenience: resolve transport from env and, when http, build the HTTP
 * client in one call. Returns `{ transport: 'sqlite', resolution }` for the
 * on-box store, or `{ transport: 'http', client, resolution }` for the hosted
 * API. Incomplete remote configuration throws before a client is built.
 */
export function createClientTransport(
  name: string,
  env: Env = process.env,
  overrides?: Partial<Pick<HasnaHttpTransportOptions, "fetchImpl" | "headers" | "timeoutMs" | "retry" | "sleepImpl">>,
):
  | { transport: "sqlite"; client: null; resolution: ClientTransportResolution }
  | { transport: "http"; client: HasnaHttpTransport; resolution: ClientTransportResolution } {
  const resolution = resolveClientTransport(name, env);
  if (resolution.transport === "sqlite" || !resolution.baseUrl) {
    return { transport: "sqlite", client: null, resolution };
  }
  const keys = clientTransportEnvKeys(name);
  const apiKey = firstEnv(env, keys.apiKeyKeys)?.value;
  if (!apiKey) {
    // Should be unreachable given resolution logic, but never build without a key.
    throw new Error(`Client for '${name}' resolved to the http transport without an API key.`);
  }
  return {
    transport: "http",
    client: createHasnaHttpTransport({
      name,
      baseUrl: resolution.baseUrl,
      apiKey,
      ...(overrides?.fetchImpl ? { fetchImpl: overrides.fetchImpl } : {}),
      ...(overrides?.headers ? { headers: overrides.headers } : {}),
      ...(overrides?.timeoutMs ? { timeoutMs: overrides.timeoutMs } : {}),
      ...(overrides?.retry !== undefined ? { retry: overrides.retry } : {}),
      ...(overrides?.sleepImpl ? { sleepImpl: overrides.sleepImpl } : {}),
    }),
    resolution,
  };
}
