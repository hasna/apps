// HTTP storage client for the Hasna Service Contract v1.
//
// The shared client seam (resolveStorageClient and the storage-client types)
// is imported from `@hasna/contracts/client` rather than vendored: a fork does
// not receive credential-resolution fixes, so the credential chain (argument,
// deliberate override, profile, disk, then the deprecated env fallback) is the
// maintained code path. This file keeps the app's own env-selection resolver
// (resolveTransport — the documented two-backend contract, incl. the
// HASNA_<APP>_CLIENT_STORE override) and the local transport/CRUD plumbing used
// by tests and the ./storage public surface; only credential resolution goes
// through the shared seam.
//
// THE CLIENT HAS EXACTLY TWO STORES: `sqlite` (an on-box file) and `http` (the
// server's `<API_URL>/v1` API with a bearer key). It NEVER opens Postgres — the
// server's internal storage engine is the server's business and is invisible
// here. Which store is active is decided by the environment alone: the
// presence of BOTH `HASNA_<APP>_API_URL` and `HASNA_<APP>_API_KEY` selects the
// hosted API. The on-box SQLite file is NEVER a silent default: an environment
// that sets neither variable fails closed with an error naming the required
// variables, and the local file is read only when the explicit
// `HASNA_<APP>_CLIENT_STORE=sqlite` override selects it. A partial hosted
// setup (one of the two variables set, the other absent) is a misconfiguration
// and fails closed — the client must never silently drift onto the wrong
// on-box dataset. The explicit `HASNA_<APP>_CLIENT_STORE` override
// (`sqlite` | `http`) wins over the auto-selection, so a config that sets
// `..._CLIENT_STORE=sqlite` keeps reading the local file even when the hosted
// URL/key pair is present.
//
// SAFETY: never logs, returns, or embeds the API key value.

import { createClientTransport } from "@hasna/contracts/client";
import {
  createHasnaStorageClient,
  resolveStorageClient,
  type HasnaStorageClient,
} from "@hasna/contracts/client/storage";

export type Env = Record<string, string | undefined>;

/** Where a client reads and writes. Two arms, no third. */
export type ClientStore = "sqlite" | "http";

function envToken(name: string): string {
  return name.toUpperCase().replace(/-/g, "_");
}

interface EnvKeys {
  /** The explicit client-store switch. Wins over auto-selection. */
  storeKeys: [string, ...string[]];
  apiUrlKeys: [string, ...string[]];
  apiKeyKeys: [string, ...string[]];
}

// The hosted contract is the HASNA_-prefixed pair only. The unprefixed
// `<APP>_API_KEY` is the legacy OpenAI transcription-key override
// (src/lib/config.ts) and must never select or fail client transport; the
// unprefixed `<APP>_API_URL` is legacy and equally outside the contract.
function envKeys(name: string): EnvKeys {
  const token = envToken(name);
  return {
    storeKeys: [`HASNA_${token}_CLIENT_STORE`, `${token}_CLIENT_STORE`],
    apiUrlKeys: [`HASNA_${token}_API_URL`],
    apiKeyKeys: [`HASNA_${token}_API_KEY`],
  };
}

function normalizeClientStore(value: string): ClientStore {
  const normalized = value.trim().toLowerCase();
  if (normalized === "sqlite") return "sqlite";
  if (normalized === "http" || normalized === "https") return "http";
  throw new Error(`Unknown client store: ${value}. Use sqlite or http.`);
}

function firstEnv(env: Env, keys: readonly string[]): { key: string; value: string } | null {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return { key, value };
  }
  return null;
}

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

export type TransportKind = ClientStore;

export interface TransportResolution {
  /**
   * The store selected by this resolution: `sqlite` when the explicit
   * `..._CLIENT_STORE=sqlite` override chose the on-box file, or when routing
   * to `http` was refused and the resolution is misconfigured. A `sqlite`
   * transport with `misconfigured: true` means NO store is active — callers
   * must fail closed, never open the on-box file.
   */
  transport: TransportKind;
  /** The store that was asked for. Differs from `transport` only when misconfigured. */
  requested: ClientStore;
  /** What decided it: an env var NAME, `auto:api-url+api-key`, or `default`. Never a value. */
  modeSource: string;
  baseUrl: string | null;
  apiKeyPresent: boolean;
  misconfigured: boolean;
  warning: string | null;
}

// Resolve where a client should read/write given the environment.
// An explicit `HASNA_<APP>_CLIENT_STORE` wins; otherwise transport is `http`
// IFF both the (prefixed) API URL and the API key are present. A partial
// hosted setup — URL without key, or key without URL — is reported as
// misconfigured (callers hard-fail) so the client never silently drifts onto
// the wrong on-box dataset. An environment that configures NOTHING is
// misconfigured too: the on-box store is not a fallback, and the client fails
// closed naming the required variables (only an explicit
// `..._CLIENT_STORE=sqlite` override selects the on-box file).
export function resolveTransport(name: string, env: Env = process.env): TransportResolution {
  const keys = envKeys(name);
  const storeHit = firstEnv(env, keys.storeKeys);
  const urlHit = firstEnv(env, keys.apiUrlKeys);
  const keyHit = firstEnv(env, keys.apiKeyKeys);

  let requested: ClientStore = "sqlite";
  let modeSource = "default";

  if (storeHit) {
    // The explicit store switch is the patch-compatible override: it wins over
    // auto-selection, so `..._CLIENT_STORE=sqlite` forces the on-box file even
    // when the hosted URL/key pair is present.
    requested = normalizeClientStore(storeHit.value);
    modeSource = storeHit.key;
  } else if (urlHit && keyHit) {
    // The presence of BOTH variables IS the signal to use the API. Rollback =
    // unset either variable -> no store is selected, never a silent local file.
    requested = "http";
    modeSource = "auto:api-url+api-key";
  } else if (urlHit || keyHit) {
    const missing = urlHit ? keys.apiKeyKeys[0] : keys.apiUrlKeys[0];
    const present = urlHit ? keys.apiUrlKeys[0] : keys.apiKeyKeys[0];
    return {
      transport: "sqlite",
      requested,
      modeSource,
      baseUrl: null,
      apiKeyPresent: Boolean(keyHit),
      misconfigured: true,
      warning:
        `${present} is set but ${missing} is not: the hosted API is only ` +
        `selected when BOTH are present. Set ${missing}, or unset ${present} ` +
        `and opt in to the on-box store explicitly with ${keys.storeKeys[0]}=sqlite.`,
    };
  }

  if (requested === "sqlite") {
    if (storeHit) {
      // Explicit on-box opt-in: the override decided it, so the local file is
      // the active store even though nothing hosted is configured.
      return { transport: "sqlite", requested, modeSource, baseUrl: null, apiKeyPresent: Boolean(keyHit), misconfigured: false, warning: null };
    }
    // Nothing is configured and nothing explicitly selected the on-box file:
    // the on-box store is never a silent default. Fail closed so a caller
    // (or the shared seam it consults for a credential) decides between the
    // hosted API and an actionable error — never a local fallback.
    return {
      transport: "sqlite",
      requested,
      modeSource,
      baseUrl: null,
      apiKeyPresent: Boolean(keyHit),
      misconfigured: true,
      warning:
        `${keys.apiUrlKeys[0]} and ${keys.apiKeyKeys[0]} are not set: the hosted ` +
        `API is selected only when BOTH are present, and the on-box store is not ` +
        `a fallback. Set both (or run through the '${name}' station wrapper), or ` +
        `opt in to the on-box store explicitly with ${keys.storeKeys[0]}=sqlite.`,
    };
  }

  if (!urlHit) {
    return {
      transport: "sqlite",
      requested,
      modeSource,
      baseUrl: null,
      apiKeyPresent: Boolean(keyHit),
      misconfigured: true,
      warning: `${modeSource}=http but no API URL is set (${keys.apiUrlKeys[0]}). Refusing to route to the API.`,
    };
  }

  if (!keyHit) {
    return {
      transport: "sqlite",
      requested,
      modeSource,
      baseUrl: null,
      apiKeyPresent: false,
      misconfigured: true,
      warning: `${modeSource}=http but no API key is set (${keys.apiKeyKeys[0]}). Refusing to route to the API.`,
    };
  }

  const rawUrl = urlHit.value;
  let baseUrl: string;
  try {
    baseUrl = toV1BaseUrl(rawUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { transport: "sqlite", requested, modeSource, baseUrl: null, apiKeyPresent: true, misconfigured: true, warning: `Invalid API URL: ${message}.` };
  }

  return { transport: "http", requested, modeSource, baseUrl, apiKeyPresent: true, misconfigured: false, warning: null };
}

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

export type ResolveStoreClientResult =
  | { transport: "sqlite"; client: null; resolution: TransportResolution }
  | { transport: "http"; client: HasnaStorageClient; resolution: TransportResolution };

// The one call the app's storage resolver makes. Selection is this file's
// documented env contract (resolveTransport — incl. the CLIENT_STORE override
// and the partial-pair fail-closed), so the app's recorded selection semantics
// are unchanged. The client itself is built through the @hasna/contracts seam,
// which resolves the credential at call time through the maintained chain
// instead of a process-start env snapshot. Throws when the hosted API is
// partially configured (so callers never silently read the wrong dataset).
export function resolveStoreClient(name: string, env: Env = process.env): ResolveStoreClientResult {
  const resolution = resolveTransport(name, env);
  if (resolution.misconfigured) {
    // A partial env pair is not necessarily a hard failure: the shared seam
    // resolves the credential at CALL TIME through the full chain (deliberate
    // override, profile, disk, then the deprecated env fallback). A URL that
    // the seam can back with a resolvable credential is a valid http client;
    // only a URL with NO resolvable credential anywhere is a true
    // misconfiguration and fails closed (never silently drift onto the wrong
    // on-box dataset). Consult the seam before throwing.
    const wired = createClientTransport(name, env);
    if (wired.transport === "http") {
      return {
        transport: "http",
        client: createHasnaStorageClient(name, wired.client),
        resolution: {
          transport: "http",
          requested: "http",
          modeSource: resolution.modeSource === "default" ? "auto:api-url+seam-credential" : resolution.modeSource,
          baseUrl: wired.resolution.baseUrl,
          apiKeyPresent: true,
          misconfigured: false,
          warning: null,
        },
      };
    }
    // The seam could not route either (no URL, or a URL with no resolvable
    // credential): keep the app's fail-closed contract.
    throw new Error(resolution.warning ?? `Client for '${name}' is misconfigured for the /v1 API.`);
  }
  if (resolution.transport === "sqlite" || !resolution.baseUrl) {
    return { transport: "sqlite", client: null, resolution };
  }
  const wired = createClientTransport(name, env);
  if (wired.transport !== "http") {
    throw new Error(`Client for '${name}' resolved to the /v1 API without an API key.`);
  }
  return { transport: "http", client: createHasnaStorageClient(name, wired.client), resolution };
}

// The canonical seam entry point, re-exported for consumers of the public
// storage surface. The seam's own resolution semantics apply (an API URL with
// a resolvable credential selects http; anything else is the local store).
export { resolveStorageClient };
export type { HasnaStorageClient };
