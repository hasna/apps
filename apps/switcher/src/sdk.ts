import type { components } from "./generated/api";
import { endpoint } from "./domain";
import { boundedJson } from "./http";
import { createClientTransport, type CredentialChainOptions, type HasnaHttpTransport } from "@hasna/contracts/client";
export { providerFromPreset } from "./presets";
export type ProviderPreset = components["schemas"]["ProviderPreset"];
export type ProviderInput = components["schemas"]["ProviderInput"];
export type Provider = components["schemas"]["Provider"];
export type ProfileInput = components["schemas"]["ProfileInput"];
export type Profile = components["schemas"]["Profile"];
export type ModelPolicy = components["schemas"]["ModelPolicy"];
export type RoutingEvent = components["schemas"]["RoutingEvent"];
export type Model = components["schemas"]["Model"];
export type Catalog = components["schemas"]["Catalog"];
export type LaunchPlan = components["schemas"]["LaunchPlan"];
export type Run = components["schemas"]["Run"];
export type Page<T> = {data: T[]; total: number; limit: number; offset: number};
export class SwitcherError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId?: string) { super(message); }
}

/** Remote diagnostics are untrusted; never turn an echoed operator key into local output. */
function apiError(status: number, data: unknown, apiKey: string): SwitcherError {
  const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
  const error = object(data) && object(data.error) ? data.error : {};
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const base64 = Buffer.from(apiKey, "utf8").toString("base64");
  // These cover ordinary diagnostic renderings, not arbitrary/nested encodings.
  const literal = [apiKey, JSON.stringify(apiKey).slice(1,-1), base64, base64.replace(/=+$/, ""), Buffer.from(apiKey, "utf8").toString("base64url")];
  const encoded = [encodeURIComponent(apiKey), new URLSearchParams({key: apiKey}).toString().slice(4)];
  const patterns = [...new Set(literal)].sort((a,b)=>b.length-a.length).map(escape);
  for (const value of encoded) {
    // Percent escapes are case insensitive; unescaped token characters are not.
    patterns.unshift(escape(value).replace(/%[0-9A-F]{2}/g, part => part.replace(/[A-F]/g, letter => `[${letter}${letter.toLowerCase()}]`)));
  }
  const reflected = new RegExp(patterns.join("|"), "g");
  const redact = (value: string) => value.replace(reflected, "[REDACTED]");
  const identifier = (value: unknown, pattern: RegExp) => typeof value === "string" && pattern.test(value) && redact(value) === value ? value : undefined;
  const code = identifier(error.code, /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/) ?? "api_error";
  const requestId = identifier(error.requestId, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
  const fallback = `Switcher API returned HTTP ${status}.`;
  // Drop oversized values rather than retaining a possibly truncated credential.
  const message = typeof error.message === "string" && error.message.length <= 4096
    ? redact(error.message).replace(/[\x00-\x1f\x7f-\x9f]/g, " ").trim().slice(0,2048) || fallback
    : fallback;
  return new SwitcherError(status, code, message, requestId);
}

export type ClientOptions = {baseUrl: string; apiKey: string | (() => string); fetch?: typeof fetch; timeoutMs?: number};
export type EnvironmentClientOptions = {credentials?: CredentialChainOptions; fetch?: typeof fetch; timeoutMs?: number};
export class SwitcherClient {
  private readonly options: ClientOptions;
  private transport?: HasnaHttpTransport;
  readonly baseUrl: string;
  constructor(options: ClientOptions) {
    this.baseUrl = endpoint(options.baseUrl).replace(/\/v1$/, "");
    if (typeof options.apiKey === "string" && (!options.apiKey || /[\r\n]/.test(options.apiKey))) throw new Error("Switcher API key is required.");
    this.options = {...options};
  }
  /** Use Contracts' paired authority/credential resolution on every request. */
  static fromEnvironment(env: Record<string,string|undefined> = process.env, options: EnvironmentClientOptions = {}) {
    const shared = createClientTransport("switcher", env, {
      credentials:options.credentials, timeoutMs:options.timeoutMs ?? 120000, retry:false,
      fetchImpl:async (input, init) => {
        // The shared transport uses v1-relative routes; these public probes are
        // served beside v1. Only the final, known route segment is rewritten.
        const address = String(input).replace(/\/v1\/(health|ready|version)$/, "/$1");
        const key = new Headers(init?.headers).get("x-api-key") ?? "";
        let response: Response;
        try { response = await (options.fetch ?? fetch)(address, init); }
        catch { throw new SwitcherError(0,"connection_failed","Switcher API request failed; check endpoint and service availability."); }
        // Auth failure bodies are never consumed or retained by a canonical client.
        if (response.status === 401 || response.status === 403) {
          await response.body?.cancel().catch(()=>{});
          throw new SwitcherError(response.status,"api_error",`Switcher API returned HTTP ${response.status}. Check the configured credential; no alternate identity was selected.`);
        }
        let data: unknown;
        try { data = await boundedJson(response); }
        catch { throw new SwitcherError(response.status,"invalid_response","Switcher API returned invalid JSON."); }
        if (!response.ok) throw apiError(response.status,data,key);
        // Preserve Switcher's response size limit before Contracts parses JSON.
        return Response.json(data);
      },
    });
    const client = new SwitcherClient({baseUrl:shared.resolution.baseUrl,apiKey:()=>{throw new Error("Shared credential transport was not invoked.");}});
    client.transport = shared.client;
    return client;
  }
  async request<T>(method: string, path: string, body?: unknown, options: {version?: number; idempotencyKey?: string} = {}): Promise<T> {
    if ((!/^\/v1\/[a-zA-Z0-9/?&=._%+-]+$/.test(path) && !["/health", "/ready", "/version"].includes(path)) || path.includes("..")) throw new Error("Invalid API path.");
    if (this.transport) return this.transport.request<T>(method,path.startsWith("/v1/") ? path.slice(3) : path,body,{
      idempotencyKey:method === "GET" ? undefined : options.idempotencyKey ?? crypto.randomUUID(),
      headers:options.version === undefined ? undefined : {"if-match":String(options.version)}, retry:false,
    });
    const apiKey = typeof this.options.apiKey === "function" ? this.options.apiKey() : this.options.apiKey;
    if (!apiKey || /[\r\n]/.test(apiKey)) throw new Error("Switcher API key is required.");
    const headers: Record<string, string> = {authorization: `Bearer ${apiKey}`, accept: "application/json"};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (method !== "GET") headers["idempotency-key"] = options.idempotencyKey ?? crypto.randomUUID();
    if (options.version !== undefined) headers["if-match"] = String(options.version);
    let response: Response;
    try { response = await (this.options.fetch ?? fetch)(`${this.baseUrl}${path}`, {method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(this.options.timeoutMs ?? 120000)}); }
    catch { throw new SwitcherError(0, "connection_failed", "Switcher API request failed; check endpoint and service availability."); }
    let data: any;
    try { data = await boundedJson(response); } catch { throw new SwitcherError(response.status, "invalid_response", "Switcher API returned invalid JSON."); }
    if (!response.ok) throw apiError(response.status, data, apiKey);
    return data as T;
  }
  private query(options: {limit?: number; offset?: number; search?: string} = {}) {
    return new URLSearchParams(Object.entries(options).filter(([,v]) => v !== undefined).map(([k,v]) => [k,String(v)])).toString();
  }
  health() { return this.request<components["schemas"]["Health"]>("GET", "/health"); }
  ready() { return this.request<components["schemas"]["Ready"]>("GET", "/ready"); }
  version() { return this.request<components["schemas"]["Version"]>("GET", "/version"); }
  listProviderPresets() { return this.request<{data: ProviderPreset[]}>("GET", "/v1/provider-presets"); }
  getProviderPreset(id: string) { return this.request<ProviderPreset>("GET", `/v1/provider-presets/${encodeURIComponent(id)}`); }
  listProviders(options = {}) { return this.request<Page<Provider>>("GET", `/v1/providers?${this.query(options)}`); }
  getProvider(id: string) { return this.request<Provider>("GET", `/v1/providers/${encodeURIComponent(id)}`); }
  createProvider(input: ProviderInput, idempotencyKey?: string) { return this.request<Provider>("POST", "/v1/providers", input, {idempotencyKey}); }
  updateProvider(input: ProviderInput, version: number, idempotencyKey?: string) { return this.request<Provider>("PUT", `/v1/providers/${encodeURIComponent(input.id)}`, input, {version, idempotencyKey}); }
  deleteProvider(id: string, version: number, idempotencyKey?: string) { return this.request<{deleted: string}>("DELETE", `/v1/providers/${encodeURIComponent(id)}`, undefined, {version, idempotencyKey}); }
  refreshModels(id: string, idempotencyKey?: string) { return this.request<Catalog>("POST", `/v1/providers/${encodeURIComponent(id)}/refresh`, {}, {idempotencyKey}); }
  listModels(id: string, options = {}) { return this.request<components["schemas"]["ModelPage"]>("GET", `/v1/providers/${encodeURIComponent(id)}/models?${this.query(options)}`); }
  listProfiles(options = {}) { return this.request<Page<Profile>>("GET", `/v1/profiles?${this.query(options)}`); }
  getProfile(id: string) { return this.request<Profile>("GET", `/v1/profiles/${encodeURIComponent(id)}`); }
  createProfile(input: ProfileInput, idempotencyKey?: string) { return this.request<Profile>("POST", "/v1/profiles", input, {idempotencyKey}); }
  updateProfile(input: ProfileInput, version: number, idempotencyKey?: string) { return this.request<Profile>("PUT", `/v1/profiles/${encodeURIComponent(input.id)}`, input, {version, idempotencyKey}); }
  deleteProfile(id: string, version: number, idempotencyKey?: string) { return this.request<{deleted: string}>("DELETE", `/v1/profiles/${encodeURIComponent(id)}`, undefined, {version, idempotencyKey}); }
  launchPlan(profileId: string, idempotencyKey?: string) { return this.request<LaunchPlan>("POST", "/v1/launch-plans", {profileId}, {idempotencyKey}); }
  listRuns(options = {}) { return this.request<Page<Run>>("GET", `/v1/runs?${this.query(options)}`); }
  getRun(id: string) { return this.request<Run>("GET", `/v1/runs/${encodeURIComponent(id)}`); }
  createRun(input: Omit<components["schemas"]["RunInput"],"modelPolicyVersion"> & {modelPolicyVersion?:1}, idempotencyKey?: string) { return this.request<Run>("POST", "/v1/runs", {...input,modelPolicyVersion:1}, {idempotencyKey}); }
  finishRun(id: string, version: number, input: components["schemas"]["RunUpdate"], idempotencyKey?: string) { return this.request<Run>("PATCH", `/v1/runs/${encodeURIComponent(id)}`, input, {version, idempotencyKey}); }
}
export function clientFromEnv(env: Record<string, string | undefined> = process.env, options: EnvironmentClientOptions = {}) {
  return SwitcherClient.fromEnvironment(env, options);
}
