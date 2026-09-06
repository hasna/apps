// Calendar domain HTTPS seam — the sole client transport.
//
// The authority AND the credential are resolved by the ONE fleet resolver in
// `@hasna/contracts/client` (owner ruling 2026-09-04, hasna/apps#1720): the
// macOS Keychain (`hasna.credentials.calendar.api-key` / `.api-url`, account
// HASNA_STATION -> hostname -s -> USER), the credentials file
// `~/.hasna/calendar/config/credentials` (owner-only 0400/0600; HASNA_HOME /
// HASNA_CONFIG_HOME move it), `HASNA_CALENDAR_API_KEY`/`_API_URL` (the
// unprefixed CALENDAR_* spellings live on as the resolver's documented silent
// alias), the deliberate `_OVERRIDE` / `_REF` / `HASNA_PROFILE` pointers, and
// the fleet gateway `https://api.hasna.com/calendar` (the client appends
// `/v1`) once a credential resolves — URLs never need configuring.
//
// This module contributes NO tier of its own. The resolver is called fresh on
// every `resolveStorageClient` / `resolveClientTransport` invocation, so the
// CLI, the MCP server, `getStore()` and `./sdk` all re-read the chain per
// request and a rotated key heals without a restart.
//
// FAIL LOUD. `resolveStorageClient` — the path every store-backed command and
// MCP tool takes — THROWS on any refusal: no credential, an unreadable
// credential file, a disagreeing pair, a locked Keychain. There is no SQLite
// fallback, no local-store default and no `*-local-fallback` event; local mode
// does not exist on this client (the only local surface is the explicit legacy
// `db-migrate` command, see local-opt-in.ts). `resolveClientTransport` is the
// one non-throwing seam, used only by diagnostics (`calendar status`) and the
// serve posture check; it classifies any refusal as `unconfigured` with the
// resolver's warning so a misconfigured box can still be steered.
//
// #1788: the resolver's Keychain tier is AMBIENT — it runs for the live
// `process.env` and never for a caller-built env object. Blank-variable
// normalisation must therefore not silently hand the resolver a copy:
// `calendarResolverInputs` (local-opt-in.ts) carries the ambient gate across
// any copy as `keychain.enabled` instead of letting the tier turn itself off.
//
// RETIRED, never inputs: the `*_MODE` / `*_STORAGE_MODE` / `*_BACKEND` /
// `*_LOCAL` / `*_SELF_HOSTED` / `*_CLOUD` placement selectors (refused as a
// ratchet below), the old `~/.hasna` fleet-env and cloud folders,
// `~/.config/hasna` with `$XDG_CONFIG_HOME`, and any `~/.calendar/config.json`
// key store (there never was one). A DEPRECATED notice for
// `HASNA_CALENDAR_API_KEY` is gone: it is a legitimate tier, deliberately
// below disk.
import { CalendarResponseError, validateResponseEnvelope } from "./response-envelope.js";
import {
  calendarResolverInputs,
  type CalendarCredentialChainOptions,
  type CalendarCredentialTier,
  type CalendarEnv,
} from "./local-opt-in.js";
import {
  resolveClientTransport as resolveContractsClientTransport,
  resolveCredential,
  type CredentialChainOptions,
} from "@hasna/contracts/client";

export type Env = CalendarEnv;
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

/** Retired placement selectors, kept as a fail-loud ratchet (see module doc). */
const RETIRED_PLACEMENT_SUFFIXES = ["MODE", "STORAGE_MODE", "BACKEND", "LOCAL", "SELF_HOSTED", "CLOUD"] as const;
const RETIRED_PLACEMENT_PREFIXES = ["HASNA_CALENDAR_", "CALENDAR_"] as const;

function firstDefined(env: Env, keys: readonly string[]): string | null {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined) return key;
  }
  return null;
}

/** Reject stale placement-selector variables even when their value is blank. */
export function assertNoRetiredCalendarSelector(env: Env): void {
  const retired: string[] = [];
  for (const prefix of RETIRED_PLACEMENT_PREFIXES) {
    for (const suffix of RETIRED_PLACEMENT_SUFFIXES) retired.push(prefix + suffix);
  }
  const hit = firstDefined(env, retired);
  if (hit) throw new Error(`Remove retired Calendar placement selectors (${hit}) and configure the HTTPS API URL and key through the @hasna/contracts credential chain.`);
}

/** Tier-1 inputs and Keychain-tier controls a calendar surface forwards to the resolver. */
export interface CalendarResolverOptions {
  /** Tier 1: an explicit key, e.g. from `--api-key` (reserved for future flags). */
  credentials?: CalendarCredentialChainOptions;
}

/**
 * What the resolver decided, in this package's seam spelling. Sources are
 * names, paths or tier words — NEVER a credential value.
 */
export type ClientTransportKind = "http-api" | "unconfigured";
export interface CalendarTransportResolution {
  transport: ClientTransportKind;
  /** `<origin>/v1` base; null when nothing resolves. */
  baseUrl: string | null;
  /** WHERE the authority came from: an env key NAME, a Keychain item reference, a file PATH, or "default". Never a value. */
  apiUrlSource: string | null;
  apiKeyPresent: boolean;
  /** WHERE the credential came from. Never a value. */
  apiKeySource: string | null;
  /** Which tier of the credential chain supplied it. */
  apiKeyTier: CalendarCredentialTier | null;
  misconfigured: boolean;
  warning: string | null;
}
export type ClientTransportResolution = CalendarTransportResolution;

const UNCONFIGURED: CalendarTransportResolution = Object.freeze({
  transport: "unconfigured",
  baseUrl: null,
  apiUrlSource: null,
  apiKeyPresent: false,
  apiKeySource: null,
  apiKeyTier: null,
  misconfigured: true,
  warning: null,
});

/**
 * The non-throwing classification seam (`calendar status`, the serve posture).
 * Any refusal — retired selector, blank, conflicting, missing, unusable — is
 * reported as `unconfigured` with the resolver's actionable warning, never
 * thrown: the diagnostic must work on a misconfigured box so it can steer.
 * The strict, throwing path is `calendarResolveStorageClient`.
 *
 * The name spells this module's adapter ("calendar…"), following the fleet's
 * credential-seam rule that a member must not DEFINE the @hasna/contracts
 * seam names itself; the seam surface is re-exported under the historic names
 * at the bottom of this module for the app's internal call sites.
 */
export function calendarResolveClientTransport(
  name: string,
  env: Env = process.env,
  options: CalendarResolverOptions = {},
): CalendarTransportResolution {
  if (typeof name !== "string" || name.trim() === "") {
    return { ...UNCONFIGURED, warning: "Calendar app slug is required." };
  }
  try {
    assertNoRetiredCalendarSelector(env);
    const inputs = calendarResolverInputs(env, options.credentials);
    const resolution = resolveContractsClientTransport(name, inputs.env, {
      credentials: inputs.credentials as CredentialChainOptions,
    });
    return {
      transport: "http-api",
      baseUrl: resolution.baseUrl,
      apiUrlSource: resolution.apiUrlSource,
      apiKeyPresent: resolution.apiKeyPresent,
      apiKeySource: resolution.apiKeySource,
      apiKeyTier: resolution.apiKeyTier as CalendarCredentialTier | null,
      misconfigured: false,
      warning: resolution.warning,
    };
  } catch (error) {
    return {
      ...UNCONFIGURED,
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Re-throw a resolver refusal as the Calendar CLI's fail-closed diagnostic. */
function calendarConfigurationError(name: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/is not set and no API key could be resolved/.test(message)) {
    return new Error(
      `HASNA_CALENDAR_API_URL is required: no Calendar credential resolved from the macOS Keychain item ` +
        `hasna.credentials.${name}.api-key, ~/.hasna/${name}/config/credentials, or HASNA_CALENDAR_API_KEY, so there is ` +
        `no hosted Calendar authority to reach. Refusing to serve local data instead — no local fallback.`,
      { cause: error },
    );
  }
  if (/no API key could be resolved/.test(message)) {
    return new Error(`HASNA_CALENDAR_API_KEY is required: ${message}`, { cause: error });
  }
  return error instanceof Error ? error : new Error(String(error));
}

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
        const result = await response.json();
        validateResponseEnvelope(upper, path, result);
        return result as T;
      } catch (e) {
        if (e instanceof CalendarResponseError) throw e;
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

/**
 * The strict resolver path: resolve ONE credential and ONE authority through
 * `@hasna/contracts/client`, fresh on every call, and build a ready client.
 * Any refusal THROWS with an actionable message — there is no local fallback.
 *
 * ONE pass down the chain, not two: the credential is resolved once and handed
 * to the authority resolution as its tier-1 argument, so a repeated `/usr/bin/security`
 * spawn (and the TOCTOU of two separate reads) is avoided; the TRUE source and
 * tier of the credential are still reported by masking the tier-1 spelling.
 * The secrets-vault pointer tier (`HASNA_CALENDAR_API_KEY_REF`) is refused
 * loudly: the Calendar transport resolves credentials synchronously at
 * construction and cannot complete a vault pointer per request.
 */
export function calendarResolveStorageClient(
  name: string,
  env: Env = process.env,
  options: CalendarResolverOptions = {},
): { transport: "http-api"; client: StorageClient; resolution: CalendarTransportResolution } {
  assertNoRetiredCalendarSelector(env);
  const inputs = calendarResolverInputs(env, options.credentials);
  const credential = resolveCredential(name, inputs.env, inputs.credentials as CredentialChainOptions);
  if (credential?.tier === "pointer") {
    // The Calendar transport resolves credentials synchronously at
    // construction and cannot complete a vault pointer per request, so a
    // deliberate pointer is refused loudly (never resolved around).
    throw new Error(
      `Calendar resolves credentials synchronously and cannot complete the secrets-vault pointer ${credential.source} per request. ` +
        `Use a literal credential tier instead: an explicit apiKey argument, the Keychain item ` +
        `hasna.credentials.${name}.api-key, ~/.hasna/${name}/config/credentials, or HASNA_CALENDAR_API_KEY.`,
    );
  }
  // ONE pass down the chain: the credential (when one resolved) is handed back
  // as the tier-1 argument so the authority resolution does no second Keychain
  // read; a missing credential makes the resolver THROW, and the refusal is
  // mapped to this CLI's fail-closed diagnostic below.
  let resolution: ReturnType<typeof resolveContractsClientTransport>;
  try {
    resolution = resolveContractsClientTransport(name, inputs.env, {
      credentials: credential
        ? ({ ...inputs.credentials, apiKey: credential.apiKey } as CredentialChainOptions)
        : (inputs.credentials as CredentialChainOptions),
    });
  } catch (error) {
    throw calendarConfigurationError(name, error);
  }
  if (!credential) {
    // Defensive, exercised by no current resolver: a resolution without a
    // credential must never produce an anonymous client.
    throw new Error(`HASNA_CALENDAR_API_URL is required: no Calendar credential resolved from the macOS Keychain item hasna.credentials.${name}.api-key, ~/.hasna/${name}/config/credentials, or HASNA_CALENDAR_API_KEY. Refusing to build an unauthenticated Calendar client — no local fallback.`);
  }
  const client = createStorageClient(name, createHttpTransport({ name, baseUrl: resolution.baseUrl, apiKey: credential.apiKey }));
  return {
    transport: "http-api",
    client,
    resolution: {
      transport: "http-api",
      baseUrl: resolution.baseUrl,
      apiUrlSource: resolution.apiUrlSource,
      apiKeyPresent: true,
      // The TRUE tier, not the tier-1 spelling the authority resolution saw.
      apiKeySource: credential.source,
      apiKeyTier: credential.tier as CalendarCredentialTier,
      misconfigured: false,
      warning: resolution.warning,
    },
  };
}

/**
 * The seam surface this app has always used, re-exported. The resolver body
 * is @hasna/contracts'; these names are imported-then-re-exported here, never
 * redefined, so the fleet credential-seam gate sees a USE, not a fork.
 */
export {
  calendarResolveClientTransport as resolveClientTransport,
  calendarResolveStorageClient as resolveStorageClient,
};