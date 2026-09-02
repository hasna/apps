// Calendar domain HTTPS seam; no claim of unpublished Contracts provenance.
export type Env = Record<string, string | undefined>;
export type QueryParams = Record<string, string | number | boolean | null | undefined>;
export interface RequestOptions { query?: QueryParams; idempotencyKey?: string; timeoutMs?: number; headers?: HeadersInit; signal?: AbortSignal | null; retries?: number; }
export function toV1BaseUrl(value: string): string {
  try {
    if (typeof value !== "string" || /[\\\s]/.test(value)) throw 0;
    const u = new URL(value);
    if (u.protocol !== "https:" || !u.hostname || u.username || u.password || u.search || u.hash) throw 0;
    const p = u.pathname.replace(/\/+$/, "");
    u.pathname = p.endsWith("/v1") ? p : p + "/v1";
    return u.href.replace(/\/$/, "");
  } catch { throw new Error("Calendar API URL must be explicit HTTPS without userinfo, query or fragment."); }
}
export function validateApiKey(value: unknown): string {
  if (typeof value !== "string" || !value || /[\s\x00-\x1f\x7f]/.test(value) || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) throw new Error("Calendar API key must be nonblank without whitespace, control characters or database URLs.");
  return value;
}
function select(env: Env, keys: string[]) {
  const hits = keys.filter(k => env[k] !== undefined);
  if (!hits.length) throw new Error(keys[0] + " is required; no local domain fallback.");
  if (hits.some(k => !env[k]?.trim() || env[k] !== env[k]?.trim())) throw new Error(keys[0] + " is blank or malformed.");
  if (hits.some(k => env[k] !== env[hits[0]!])) throw new Error(keys[0] + " conflicts with its alias.");
  return { key: hits[0]!, value: env[hits[0]!]! };
}
function configuration(name: string, env: Env) {
  const token = name.toUpperCase().replace(/-/g, "_");
  for (const s of ["MODE", "STORAGE_MODE", "BACKEND", "LOCAL", "SELF_HOSTED", "CLOUD"]) {
    if (["HASNA_" + token + "_" + s, token + "_" + s].some(k => env[k] !== undefined)) throw new Error("Remove retired Calendar placement selectors and configure the HTTPS API URL and key.");
  }
  const url = select(env, ["HASNA_" + token + "_API_URL", token + "_API_URL"]);
  const key = select(env, ["HASNA_" + token + "_API_KEY", token + "_API_KEY"]);
  return { baseUrl: toV1BaseUrl(url.value), apiKey: validateApiKey(key.value), urlSource: url.key, keySource: key.key };
}
export type ClientTransportKind = "http-api" | "unconfigured";
export function resolveClientTransport(name: string, env: Env = process.env) {
  try { const c = configuration(name, env); return { transport: "http-api" as ClientTransportKind, baseUrl: c.baseUrl, apiUrlSource: c.urlSource, apiKeyPresent: true, apiKeySource: c.keySource, misconfigured: false, warning: null }; }
  catch (e) { return { transport: "unconfigured" as ClientTransportKind, baseUrl: null, apiUrlSource: null, apiKeyPresent: false, apiKeySource: null, misconfigured: true, warning: (e as Error).message }; }
}
export type ClientTransportResolution = ReturnType<typeof resolveClientTransport>;
export class HasnaHttpError extends Error {
  readonly body: unknown = undefined;
  constructor(readonly method: string, readonly path: string, readonly status: number, _body?: unknown) { super("Calendar API request failed (" + status + ")."); this.name = "HasnaHttpError"; }
}
export interface HttpTransport {
  readonly baseUrl: string;
  request<T = unknown>(method: string, path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  get<T = unknown>(path: string, opts?: RequestOptions): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  put<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  del<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
}
export function createHttpTransport(options: { name: string; baseUrl: string; apiKey: string; fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>; timeoutMs?: number; retries?: number }): HttpTransport {
  const base = toV1BaseUrl(options.baseUrl), key = validateApiKey(options.apiKey);
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeout = options.timeoutMs ?? 30000, defaults = options.retries ?? 2;
  async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
    if (!path.startsWith("/") || path.startsWith("//") || /[\\?#]/.test(path) || path.split("/").some(s => /^(\.|%2e){1,2}$/i.test(s))) throw new Error("Calendar request path escapes the API boundary.");
    const url = new URL(base + path);
    if (!url.href.startsWith(base + "/")) throw new Error("Calendar API boundary violation.");
    for (const [k,v] of Object.entries(opts.query ?? {})) if (v != null) url.searchParams.set(k, String(v));
    const headers = new Headers(opts.headers);
    for (const h of ["authorization", "x-api-key", "host", "cookie", "proxy-authorization"]) if (headers.has(h)) throw new Error("Calendar authority headers cannot be overridden.");
    headers.set("x-api-key", key); headers.set("authorization", "Bearer " + key); headers.set("accept", "application/json");
    if (opts.idempotencyKey) headers.set("idempotency-key", opts.idempotencyKey);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload !== undefined) headers.set("content-type", "application/json");
    const upper = method.toUpperCase();
    // Calendar's server has no write deduplication; never automatically retry writes.
    const retries = ["GET", "HEAD"].includes(upper) ? opts.retries ?? defaults : 0;
    if (!Number.isInteger(retries) || retries < 0 || retries > 5) throw new Error("Invalid Calendar retry limit.");
    const timeoutMs = opts.timeoutMs ?? timeout, signal = opts.signal;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid Calendar timeout.");
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw new Error("Calendar request cancelled.");
      const controller = new AbortController(), abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, timeoutMs);
      try {
        const response = await fetchImpl(url.href, { method: upper, headers: new Headers(headers), body: payload, redirect: "error", signal: controller.signal });
        if (response.redirected) throw new Error("Calendar redirect rejected.");
        if (!response.ok) throw new HasnaHttpError(upper, path, response.status);
        return response.status === 204 ? undefined as T : await response.json() as T;
      } catch (e) {
        const retryable = !(e instanceof HasnaHttpError) || [408,425,429,500,502,503,504].includes(e.status);
        if (signal?.aborted || !retryable || attempt >= retries) { if (e instanceof HasnaHttpError) throw e; throw new Error("Calendar API request failed; no local fallback."); }
      } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
    }
  }
  return Object.freeze({ baseUrl: base, request,
    get: <T>(p: string,o?: RequestOptions) => request<T>("GET",p,undefined,o),
    post: <T>(p: string,b?: unknown,o?: RequestOptions) => request<T>("POST",p,b,o),
    put: <T>(p: string,b?: unknown,o?: RequestOptions) => request<T>("PUT",p,b,o),
    patch: <T>(p: string,b?: unknown,o?: RequestOptions) => request<T>("PATCH",p,b,o),
    del: <T>(p: string,b?: unknown,o?: RequestOptions) => request<T>("DELETE",p,b,o) });
}
export interface StorageClient {
 readonly name: string; readonly baseUrl: string; readonly transport: HttpTransport;
 list<T = unknown>(r: string, o?: RequestOptions): Promise<T>;
 get<T = unknown>(r: string,id: string,o?: RequestOptions): Promise<T | null>;
 create<T = unknown>(r: string,b: unknown,o?: RequestOptions): Promise<T>;
 update<T = unknown>(r: string,id: string,b: unknown,o?: RequestOptions & {method?: "PATCH" | "PUT"}): Promise<T>;
 delete<T = unknown>(r: string,id: string,o?: RequestOptions): Promise<T>;
}
function entity(r: string,id: string) { return "/" + r + "/" + encodeURIComponent(String(id)); }
export function createStorageClient(name: string, transport: HttpTransport): StorageClient {
 return Object.freeze({name, baseUrl: transport.baseUrl, transport,
 list: <T>(r: string,o?: RequestOptions) => transport.get<T>("/"+r,o),
 get: async <T>(r: string,id: string,o?: RequestOptions): Promise<T | null> => { try { return await transport.get<T>(entity(r,id),o); } catch(e) { if(e instanceof HasnaHttpError && e.status === 404) return null; throw e; } },
 create: <T>(r: string,b: unknown,o?: RequestOptions) => transport.post<T>("/"+r,b,{...o,idempotencyKey:o?.idempotencyKey ?? crypto.randomUUID()}),
 update: <T>(r: string,id: string,b: unknown,o?: RequestOptions & {method?: "PATCH" | "PUT"}) => transport.request<T>(o?.method ?? "PATCH",entity(r,id),b,o),
 delete: <T>(r: string,id: string,o?: RequestOptions) => transport.del<T>(entity(r,id),undefined,o) });
}
export function resolveStorageClient(name: string, env: Env = process.env) {
 const c = configuration(name,env);
 return {transport: "http-api" as const,client:createStorageClient(name,createHttpTransport({name,baseUrl:c.baseUrl,apiKey:c.apiKey})),resolution:resolveClientTransport(name,env)};
}
