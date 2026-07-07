// Self-hosted (cloud-http) storage client for this app's `/v1` API.
//
// This is the client-side piece that makes `self_hosted` mode real. When the
// operator sets the client-flip env for this app:
//
//   HASNA_<APP>_STORAGE_MODE = self_hosted   (aliases: cloud | remote | hybrid)
//   HASNA_<APP>_API_URL      = https://<app>.hasna.xyz   (optional; default host)
//   HASNA_<APP>_API_KEY      = <bearer key>
//
// ...the resolver returns a ready HTTP client whose list/get/create/update/delete
// calls hit `<API_URL>/v1/<resource>` with the API key. Otherwise it returns
// `{ transport: 'local', client: null }` so the app uses its local SQLite store.
// Unsetting the env reverts to local — the flip is fully reversible.
//
// This module is a repo-local vendoring of the @hasna/contracts client storage
// kit (createClientTransport + createHasnaStorageClient). It is intentionally
// self-contained (no external imports) so the built CLI/MCP/SDK bundle carries
// the cloud client with zero extra runtime dependencies.
//
// SAFETY: the API key value is never logged, returned, or embedded anywhere; it
// lives only inside the transport closure and travels only in request headers.

export type Env = Record<string, string | undefined>;

const DEPRECATED_MODE_ALIASES = new Set(["remote", "hybrid", "self_hosted"]);

function envToken(name: string): string {
  return name.toUpperCase().replace(/-/g, "_");
}

/** Normalize a raw storage-mode string to `local | cloud`. */
function normalizeMode(value: string): "local" | "cloud" | null {
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "local") return "local";
  if (normalized === "cloud") return "cloud";
  if (DEPRECATED_MODE_ALIASES.has(normalized)) return "cloud";
  return null;
}

function firstEnv(env: Env, keys: readonly string[]): { key: string; value: string } | null {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return { key, value };
  }
  return null;
}

function clientEnvKeys(name: string) {
  const token = envToken(name);
  return {
    modeKeys: [
      `HASNA_${token}_STORAGE_MODE`,
      `HASNA_${token}_MODE`,
      `${token}_STORAGE_MODE`,
      `${token}_MODE`,
    ],
    apiUrlKeys: [`HASNA_${token}_API_URL`, `${token}_API_URL`],
    apiKeyKeys: [`HASNA_${token}_API_KEY`, `${token}_API_KEY`],
  };
}

function defaultCloudBaseUrl(name: string): string {
  return `https://${name}.hasna.xyz`;
}

/** Normalize a base URL to `<origin>/v1`. */
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
  transport: ClientTransportKind;
  mode: "local" | "cloud";
  modeSource: string;
  baseUrl: string | null;
  apiKeyPresent: boolean;
  apiKeySource: string | null;
  misconfigured: boolean;
  warning: string | null;
}

/**
 * Decide whether this client should read/write from the cloud API or locally.
 * Cloud-http IFF the resolved mode is cloud/self_hosted AND an API key is set.
 * If cloud is requested but the key is missing/invalid, returns local with
 * `misconfigured: true` so callers can hard-fail instead of drifting.
 */
export function resolveClientTransport(name: string, env: Env = process.env): ClientTransportResolution {
  const keys = clientEnvKeys(name);
  const modeHit = firstEnv(env, keys.modeKeys);
  const urlHit = firstEnv(env, keys.apiUrlKeys);
  const keyHit = firstEnv(env, keys.apiKeyKeys);

  let mode: "local" | "cloud" = "local";
  let modeSource = "default";
  const warnings: string[] = [];

  if (modeHit) {
    const normalized = normalizeMode(modeHit.value);
    if (normalized === null) {
      warnings.push(`Unknown storage mode '${modeHit.value}' from ${modeHit.key}; using local.`);
    } else {
      mode = normalized;
      modeSource = modeHit.key;
    }
  }

  if (mode === "local") {
    return {
      transport: "local",
      mode,
      modeSource,
      baseUrl: null,
      apiKeyPresent: Boolean(keyHit),
      apiKeySource: keyHit ? keyHit.key : null,
      misconfigured: false,
      warning: warnings.length > 0 ? warnings.join(" ") : null,
    };
  }

  if (!keyHit) {
    warnings.push(
      `${modeSource}=self_hosted but no API key is set (${keys.apiKeyKeys[0]}). Refusing to route to cloud; using local store.`,
    );
    return {
      transport: "local",
      mode,
      modeSource,
      baseUrl: null,
      apiKeyPresent: false,
      apiKeySource: null,
      misconfigured: true,
      warning: warnings.join(" "),
    };
  }

  const rawUrl = urlHit?.value ?? defaultCloudBaseUrl(name);
  let baseUrl: string;
  try {
    baseUrl = toV1BaseUrl(rawUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`Invalid API URL from ${urlHit ? urlHit.key : "default"}: ${message}. Using local store.`);
    return {
      transport: "local",
      mode,
      modeSource,
      baseUrl: null,
      apiKeyPresent: true,
      apiKeySource: keyHit.key,
      misconfigured: true,
      warning: warnings.join(" "),
    };
  }

  return {
    transport: "cloud-http",
    mode,
    modeSource,
    baseUrl,
    apiKeyPresent: true,
    apiKeySource: keyHit.key,
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
    super(`Cloud request failed: ${method} ${path} -> ${status}`);
    this.name = "HasnaHttpError";
    this.status = status;
    this.method = method;
    this.path = path;
    this.body = body;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  query?: QueryParams;
  idempotencyKey?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  retries?: number;
}

const DEFAULT_RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);

function appendQuery(path: string, query?: QueryParams): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    params.append(key, String(value));
  }
  const qs = params.toString();
  if (!qs) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${qs}`;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface HttpTransport {
  readonly baseUrl: string;
  request<T = unknown>(method: string, path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  get<T = unknown>(path: string, opts?: RequestOptions): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  put<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  del<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
}

interface TransportOptions {
  name: string;
  baseUrl: string;
  apiKey: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  retries?: number;
}

export function createHttpTransport(options: TransportOptions): HttpTransport {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const base = options.baseUrl.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 30_000;
  const defaultRetries = options.retries ?? 2;

  async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
    const upper = method.toUpperCase();
    const rel = appendQuery(path.startsWith("/") ? path : `/${path}`, opts.query);
    const url = `${base}${rel}`;
    const methodRetryable = IDEMPOTENT_METHODS.has(upper) || Boolean(opts.idempotencyKey);
    const maxRetries = opts.retries ?? defaultRetries;
    const maxAttempts = methodRetryable ? maxRetries + 1 : 1;

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const headers: Record<string, string> = {
        "x-api-key": options.apiKey,
        Authorization: `Bearer ${options.apiKey}`,
        Accept: "application/json",
        ...(opts.headers ?? {}),
      };
      if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
      const init: RequestInit = { method: upper, headers };
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
        clearTimeout(timer);
        if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
        // Caller-initiated abort is a cancellation, not a transient failure.
        if (opts.signal?.aborted) throw err;
        lastError = err;
        if (methodRetryable && attempt < maxAttempts) {
          await sleep(Math.min(2_000, 200 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 100));
          continue;
        }
        throw err;
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
        const err = new HasnaHttpError(upper, rel, response.status, parsed);
        if (methodRetryable && DEFAULT_RETRY_STATUSES.has(response.status) && attempt < maxAttempts) {
          lastError = err;
          await sleep(Math.min(2_000, 200 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 100));
          continue;
        }
        throw err;
      }
      return parsed as T;
    }
    throw lastError ?? new Error("request failed");
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

function resourcePath(resource: string): string {
  const trimmed = resource.replace(/^\/+|\/+$/g, "");
  if (!trimmed) throw new Error("resource must be a non-empty path segment");
  return `/${trimmed}`;
}

function entityPath(resource: string, id: string): string {
  if (id === undefined || id === null || `${id}`.length === 0) {
    throw new Error("id must be a non-empty string");
  }
  return `${resourcePath(resource)}/${encodeURIComponent(String(id))}`;
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
  list<T = unknown>(resource: string, opts?: RequestOptions): Promise<T>;
  get<T = unknown>(resource: string, id: string, opts?: RequestOptions): Promise<T | null>;
  create<T = unknown>(resource: string, body: unknown, opts?: RequestOptions): Promise<T>;
  update<T = unknown>(resource: string, id: string, patch: unknown, opts?: RequestOptions & { method?: "PATCH" | "PUT" }): Promise<T>;
  delete<T = unknown>(resource: string, id: string, opts?: RequestOptions): Promise<T>;
}

export function createStorageClient(name: string, transport: HttpTransport): StorageClient {
  return {
    name,
    baseUrl: transport.baseUrl,
    transport,
    list: (resource, opts) => transport.get(resourcePath(resource), opts),
    async get(resource, id, opts) {
      try {
        return await transport.get(entityPath(resource, id), opts);
      } catch (error) {
        if (error instanceof HasnaHttpError && error.status === 404) return null;
        throw error;
      }
    },
    create: (resource, body, opts = {}) =>
      transport.post(resourcePath(resource), body, {
        ...opts,
        idempotencyKey: opts.idempotencyKey ?? newIdempotencyKey(),
      }),
    update: (resource, id, patch, opts = {}) => {
      const { method = "PATCH", ...rest } = opts;
      const call = method === "PUT" ? transport.put : transport.patch;
      return call(entityPath(resource, id), patch, rest);
    },
    async delete(resource, id, opts) {
      try {
        return await transport.del(entityPath(resource, id), undefined, opts);
      } catch (error) {
        if (error instanceof HasnaHttpError && error.status === 404) return undefined as never;
        throw error;
      }
    },
  };
}

export type ResolveStorageClientResult =
  | { transport: "local"; client: null; resolution: ClientTransportResolution }
  | { transport: "cloud-http"; client: StorageClient; resolution: ClientTransportResolution };

/**
 * The one call the app's storage resolver makes. Reads the client-flip env for
 * `name`; returns a ready cloud client when self_hosted + API key are set, else
 * `{ transport: 'local', client: null }`. Throws if cloud was requested but is
 * misconfigured (so callers never silently read the wrong dataset).
 */
export function resolveStorageClient(name: string, env: Env = process.env): ResolveStorageClientResult {
  const resolution = resolveClientTransport(name, env);
  if (resolution.misconfigured) {
    throw new Error(resolution.warning ?? `Client for '${name}' is misconfigured for self_hosted mode.`);
  }
  if (resolution.transport === "local" || !resolution.baseUrl) {
    return { transport: "local", client: null, resolution };
  }
  const keys = clientEnvKeys(name);
  const apiKey = firstEnv(env, keys.apiKeyKeys)?.value;
  if (!apiKey) {
    throw new Error(`Client for '${name}' resolved to cloud-http without an API key.`);
  }
  const transport = createHttpTransport({ name, baseUrl: resolution.baseUrl, apiKey });
  return { transport: "cloud-http", client: createStorageClient(name, transport), resolution };
}
