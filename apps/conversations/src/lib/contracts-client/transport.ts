import { readFileSync, statSync } from "node:fs";
// Client-side transport resolver for the Hasna Service Contract v1.
//
// THIS IS THE B2 CORE FIX. Historically, a client was told to use the hosted
// API and the CLI/MCP still read the local SQLite/db.json store. A DSN on the
// client does NOT switch the dataset a CLI reads.
//
// This module makes the client actually talk to the hosted API. Given an app
// name and the environment it decides whether reads AND writes should be routed
// to the app's hosted HTTP API (`<API_URL>/v1`, default
// `https://<app>.hasna.xyz/v1`) with the API key, or fall through to the local
// store.
//
// THE CLIENT-FLIP CONTRACT (env vars). The client selects the hosted API by the
// URL + key pair, and the local store by their absence (owner directive
// 2026-07-29). For app `<NAME>` = envToken(name):
//
//   API base URL (optional; `/v1` is appended automatically):
//     HASNA_<NAME>_API_URL = https://<app>.hasna.xyz
//     <NAME>_API_URL                                                  (alias)
//   API key (bearer / x-api-key):
//     HASNA_<NAME>_API_KEY = hasna_<app>_...
//     <NAME>_API_KEY                                                  (alias)
//
// DECISION: transport is `cloud-http` IFF the API url AND the API key are both
// present. The base URL defaults to `https://<app>.hasna.xyz` when a key is
// present but no URL is set. Half a configuration — exactly one of url or key —
// is ambiguous, so the resolver does NOT silently serve wrong local data: it
// returns `local` with a loud `warning` and `misconfigured: true` so the caller
// can hard-fail instead of drifting.
//
// SAFETY: this module never returns, logs, or embeds the API key value. Callers
// receive only presence flags and env-key names.

/** Environment map (subset of NodeJS.ProcessEnv). */
export type Env = Record<string, string | undefined>;

/** Upper-snake env token for an app name, e.g. `economy` -> `ECONOMY`. */
export function envToken(name: string): string {
  return name.toUpperCase().replace(/-/g, "_");
}

/** Default hosted-API host template. `<app>` is the app slug. */
export function defaultCloudBaseUrl(name: string): string {
  return `https://${name}.hasna.xyz`;
}

export interface ClientTransportEnvKeys {
  /** API base-URL keys, in precedence order. */
  apiUrlKeys: string[];
  /** API-key keys, in precedence order. */
  apiKeyKeys: string[];
}

/** Resolve the canonical client-flip env-key spec for an app. */
export function clientTransportEnvKeys(name: string): ClientTransportEnvKeys {
  const token = envToken(name);
  return {
    apiUrlKeys: [`HASNA_${token}_API_URL`, `${token}_API_URL`],
    apiKeyKeys: [`HASNA_${token}_API_KEY`, `${token}_API_KEY`],
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

export type ClientTransportKind = "local" | "cloud-http";

export interface ClientTransportResolution {
  /** Where the client should read/write from. */
  transport: ClientTransportKind;
  /** `<origin>/v1` base for the hosted API when transport is cloud-http, else null. */
  baseUrl: string | null;
  /** Env key the API URL came from, `"default"` (host template), or null. */
  apiUrlSource: string | null;
  /** Whether an API key is present (value never exposed). */
  apiKeyPresent: boolean;
  /** Env key the API key came from, or null. */
  apiKeySource: string | null;
  /**
   * True when the operator configured half the API pair (url without key, or
   * key without url), so we fell back to local. Callers SHOULD treat this as an
   * error rather than silently reading local data.
   */
  misconfigured: boolean;
  /** Human-readable warning, or null. Never contains secret values. */
  warning: string | null;
}

/** The PRIMARY fleet credential dir — `~/.hasna/fleet-env/<app>.env`. */
const FLEET_CREDENTIAL_DIR = "fleet-env";

/**
 * Read the PRIMARY fleet-env disk tier (P1-B, todos 12e26c2b). The legacy
 * `~/.hasna/cloud/<app>.env` location is deprecated (removed after 2026-10-01);
 * the fleet-env file is re-read on every call so a rotation heals without a
 * new process. Values are never logged; only key NAMES are surfaced.
 */
function readFleetEnvFile(name: string, env: Env): Map<string, string> | null {
  const home = env.HOME?.trim() || env.USERPROFILE?.trim();
  if (!home) return null;
  const safeSlug = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name);
  if (!safeSlug) return null;
  const path = `${home}/.hasna/${FLEET_CREDENTIAL_DIR}/${name}.env`;
  let text: string;
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > 64 * 1024) return null;
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const values = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const equals = withoutExport.indexOf("=");
    if (equals <= 0) continue;
    const key = withoutExport.slice(0, equals).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = withoutExport.slice(equals + 1).trim();
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      if (value.length < 2 || !value.endsWith(quote)) continue;
      value = value.slice(1, -1);
    }
    if (value.length === 0) continue;
    values.set(key, value);
  }
  return values;
}

/**
 * Resolve how a client should reach an app's data given the environment.
 *
 * The API url + key pair selects the hosted API; anything else selects the
 * local store. A partial pair is ambiguous and is flagged `misconfigured`
 * rather than resolved to either store silently.
 *
 * P1-B: when the environment is fully silent, the PRIMARY fleet-env disk tier
 * (`~/.hasna/fleet-env/<name>.env`) is consulted before falling to local —
 * the same order the @hasna/contracts resolver uses. The legacy
 * `~/.hasna/cloud/<name>.env` location is deprecated (removed after
 * 2026-10-01).
 */
export function resolveClientTransport(name: string, env: Env = process.env): ClientTransportResolution {
  const keys = clientTransportEnvKeys(name);
  let urlHit = firstEnv(env, keys.apiUrlKeys);
  let keyHit = firstEnv(env, keys.apiKeyKeys);
  let diskSource: string | null = null;

  // P1-B disk tier: consult the fleet-env file only when the environment is
  // fully silent about the URL, so an explicit env always wins over disk.
  if (!urlHit && !keyHit) {
    const disk = readFleetEnvFile(name, env);
    if (disk) {
      const home = env.HOME?.trim() || env.USERPROFILE?.trim() || "<HOME>";
      diskSource = `${home}/.hasna/${FLEET_CREDENTIAL_DIR}/${name}.env`;
      for (const urlKey of keys.apiUrlKeys) {
        const v = disk.get(urlKey)?.trim();
        if (v) {
          urlHit = { key: diskSource, value: v };
          break;
        }
      }
      for (const keyKey of keys.apiKeyKeys) {
        const v = disk.get(keyKey)?.trim();
        if (v) {
          keyHit = { key: diskSource, value: v };
          break;
        }
      }
    }
  }

  const warnings: string[] = [];

  // No API configuration at all: the local store is the documented default.
  if (!urlHit && !keyHit) {
    return {
      transport: "local",
      baseUrl: null,
      apiUrlSource: null,
      apiKeyPresent: false,
      apiKeySource: null,
      misconfigured: false,
      warning: null,
    };
  }

  // Half a configuration is an error, never a fall-back to local: an operator
  // who set one half plainly intended the hosted API, and silently serving the
  // on-box SQLite store in its place would answer from a different dataset.
  if (urlHit && !keyHit) {
    warnings.push(
      `${urlHit.key} points at the hosted API but no API key is set (${keys.apiKeyKeys[0]}). ` +
        `Refusing to route to the hosted API; using the local store. ` +
        `Set ${keys.apiKeyKeys[0]} to enable the hosted client.`,
    );
    return {
      transport: "local",
      baseUrl: null,
      apiUrlSource: urlHit.key,
      apiKeyPresent: false,
      apiKeySource: null,
      misconfigured: true,
      warning: warnings.join(" "),
    };
  }
  if (!urlHit && keyHit) {
    warnings.push(
      `${keyHit.key} is set but no API URL is set (${keys.apiUrlKeys[0]}), so the hosted API ` +
        `cannot be reached. Refusing to route to the hosted API; using the local store. ` +
        `Set ${keys.apiUrlKeys[0]} to enable the hosted client.`,
    );
    return {
      transport: "local",
      baseUrl: null,
      apiUrlSource: null,
      apiKeyPresent: true,
      apiKeySource: keyHit.key,
      misconfigured: true,
      warning: warnings.join(" "),
    };
  }

  const rawUrl = urlHit!.value;
  const apiUrlSource = urlHit!.key;
  let baseUrl: string;
  try {
    baseUrl = toV1BaseUrl(rawUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`Invalid API URL from ${apiUrlSource}: ${message}. Using local store.`);
    return {
      transport: "local",
      baseUrl: null,
      apiUrlSource,
      apiKeyPresent: true,
      apiKeySource: keyHit!.key,
      misconfigured: true,
      warning: warnings.join(" "),
    };
  }

  return {
    transport: "cloud-http",
    baseUrl,
    apiUrlSource,
    apiKeyPresent: true,
    apiKeySource: keyHit!.key,
    misconfigured: false,
    warning: warnings.length > 0 ? warnings.join(" ") : null,
  };
}

/** Thrown when a cloud HTTP request returns a non-2xx status. */
export class HasnaHttpError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  constructor(method: string, path: string, status: number, body: unknown) {
    const detail = httpErrorDetail(body);
    super(`Hasna cloud request failed: ${method} ${path} -> ${status}${detail ? `: ${detail}` : ""}`);
    this.name = "HasnaHttpError";
    this.status = status;
    this.method = method;
    this.path = path;
    this.body = body;
  }
}

/**
 * Keep the server's actionable error context on the Error itself. Do not
 * stringify arbitrary response objects: API error bodies can contain fields
 * that are not intended for logs. These are the documented diagnostic fields.
 */
function httpErrorDetail(body: unknown): string {
  if (typeof body === "string") return body.trim();
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  const record = body as Record<string, unknown>;
  const fields = ["error", "reason", "code", "field", "hint"];
  return fields
    .filter((field) => typeof record[field] === "string" && String(record[field]).trim())
    .map((field) => `${field}=${String(record[field]).trim()}`)
    .join("; ");
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
 * Build an authenticated HTTP transport for an app's hosted `/v1` API. Sends the
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
 * Convenience: resolve transport from env and, when cloud-http, build the HTTP
 * client in one call. Returns `{ transport: 'local', resolution }` for local, or
 * `{ transport: 'cloud-http', client, resolution }` for the hosted API. Throws
 * if the config is `misconfigured` (a partial API pair) so callers can't drift
 * onto local data by accident.
 */
export function createClientTransport(
  name: string,
  env: Env = process.env,
  overrides?: Partial<Pick<HasnaHttpTransportOptions, "fetchImpl" | "headers" | "timeoutMs" | "retry" | "sleepImpl">>,
):
  | { transport: "local"; client: null; resolution: ClientTransportResolution }
  | { transport: "cloud-http"; client: HasnaHttpTransport; resolution: ClientTransportResolution } {
  const resolution = resolveClientTransport(name, env);
  if (resolution.misconfigured) {
    throw new Error(resolution.warning ?? `Client for '${name}' is misconfigured for the hosted API.`);
  }
  if (resolution.transport === "local" || !resolution.baseUrl) {
    return { transport: "local", client: null, resolution };
  }
  const keys = clientTransportEnvKeys(name);
  const apiKey = firstEnv(env, keys.apiKeyKeys)?.value;
  if (!apiKey) {
    // Should be unreachable given resolution logic, but never build without a key.
    throw new Error(`Client for '${name}' resolved to cloud-http without an API key.`);
  }
  return {
    transport: "cloud-http",
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
