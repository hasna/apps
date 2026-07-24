import type {
  CloudflareWorkersConfig,
  CloudflareWorkersRawResponse,
  CloudflareWorkersRequestOptions,
  HttpMethod,
  JsonObject,
  QueryParams,
  QueryValue,
  RequestBody,
} from "../types";
import { CloudflareWorkersApiError } from "../types";

const DEFAULT_BASE_URL = "https://api.cloudflare.com/client/v4";
const DEFAULT_TIMEOUT_MS = 30_000;

export class CloudflareWorkersClient {
  private readonly apiToken?: string;
  private readonly accountId?: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: CloudflareWorkersConfig = {}) {
    this.apiToken = config.apiToken;
    this.accountId = config.accountId;
    this.baseUrl = this.cleanBaseUrl(config.baseUrl || DEFAULT_BASE_URL);
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  request<T = unknown>(path: string, options: CloudflareWorkersRequestOptions = {}): Promise<T> {
    return this.fetchPath<T>(this.resolvePath(path), options);
  }

  listScripts(query: QueryParams = {}) {
    return this.fetchPath(this.accountPath("/workers/scripts"), { method: "GET", query });
  }

  getScript(scriptName: string) {
    return this.fetchPath(this.scriptPath(scriptName), { method: "GET" });
  }

  getScriptContent(scriptName: string): Promise<string> {
    return this.fetchPath(this.scriptPath(scriptName), { method: "GET", headers: { Accept: "application/javascript, text/plain, */*" }, responseType: "text" });
  }

  uploadScript(scriptName: string, script: string | Uint8Array | ArrayBuffer | Blob, options: { metadata?: JsonObject; filename?: string; contentType?: string } = {}) {
    const filename = options.filename || "worker.js";
    const metadata = options.metadata || { main_module: filename };
    const mainModule = typeof metadata.main_module === "string" && metadata.main_module.trim()
      ? metadata.main_module
      : filename;
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }), "metadata.json");
    form.append(mainModule, new Blob([this.blobPart(script)], { type: options.contentType || "application/javascript" }), filename);
    return this.fetchPath(this.scriptPath(scriptName), { method: "PUT", body: form, rawBody: true });
  }

  deleteScript(scriptName: string) {
    return this.fetchPath(this.scriptPath(scriptName), { method: "DELETE" });
  }

  getScriptSettings(scriptName: string) {
    return this.fetchPath(`${this.scriptPath(scriptName)}/settings`, { method: "GET" });
  }

  updateScriptSettings(scriptName: string, body: JsonObject) {
    return this.fetchPath(`${this.scriptPath(scriptName)}/settings`, { method: "PATCH", body: this.requireObject(body, "settings body") });
  }

  listDeployments(scriptName: string) {
    return this.fetchPath(`${this.scriptPath(scriptName)}/deployments`, { method: "GET" });
  }

  createDeployment(scriptName: string, body: JsonObject) {
    return this.fetchPath(`${this.scriptPath(scriptName)}/deployments`, { method: "POST", body: this.requireObject(body, "deployment body") });
  }

  listVersions(scriptName: string) {
    return this.fetchPath(`${this.scriptPath(scriptName)}/versions`, { method: "GET" });
  }

  getVersion(scriptName: string, versionId: string) {
    return this.fetchPath(`${this.scriptPath(scriptName)}/versions/${this.segment(versionId, "versionId")}`, { method: "GET" });
  }

  listSecrets(scriptName: string) {
    return this.fetchPath(`${this.scriptPath(scriptName)}/secrets`, { method: "GET" });
  }

  putSecret(scriptName: string, body: JsonObject) {
    return this.fetchPath(`${this.scriptPath(scriptName)}/secrets`, { method: "PUT", body: this.requireObject(body, "secret body") });
  }

  deleteSecret(scriptName: string, secretName: string) {
    return this.fetchPath(`${this.scriptPath(scriptName)}/secrets/${this.segment(secretName, "secretName")}`, { method: "DELETE" });
  }

  getSchedules(scriptName: string) {
    return this.fetchPath(`${this.scriptPath(scriptName)}/schedules`, { method: "GET" });
  }

  putSchedules(scriptName: string, body: JsonObject) {
    return this.fetchPath(`${this.scriptPath(scriptName)}/schedules`, { method: "PUT", body: this.requireObject(body, "schedules body") });
  }

  createTail(scriptName: string) {
    return this.fetchPath(`${this.scriptPath(scriptName)}/tails`, { method: "POST", body: {} });
  }

  deleteTail(scriptName: string, tailId: string) {
    return this.fetchPath(`${this.scriptPath(scriptName)}/tails/${this.segment(tailId, "tailId")}`, { method: "DELETE" });
  }

  getAccountSubdomain() {
    return this.fetchPath(this.accountPath("/workers/subdomain"), { method: "GET" });
  }

  updateAccountSubdomain(body: JsonObject) {
    return this.fetchPath(this.accountPath("/workers/subdomain"), { method: "PUT", body: this.requireObject(body, "subdomain body") });
  }

  getScriptSubdomain(scriptName: string) {
    return this.fetchPath(`${this.scriptPath(scriptName)}/subdomain`, { method: "GET" });
  }

  updateScriptSubdomain(scriptName: string, body: JsonObject) {
    return this.fetchPath(`${this.scriptPath(scriptName)}/subdomain`, { method: "POST", body: this.requireObject(body, "script subdomain body") });
  }

  listRoutes(zoneId: string) {
    return this.fetchPath(`/zones/${this.segment(zoneId, "zoneId")}/workers/routes`, { method: "GET" });
  }

  getRoute(zoneId: string, routeId: string) {
    return this.fetchPath(`/zones/${this.segment(zoneId, "zoneId")}/workers/routes/${this.segment(routeId, "routeId")}`, { method: "GET" });
  }

  createRoute(zoneId: string, body: JsonObject) {
    return this.fetchPath(`/zones/${this.segment(zoneId, "zoneId")}/workers/routes`, { method: "POST", body: this.requireObject(body, "route body") });
  }

  updateRoute(zoneId: string, routeId: string, body: JsonObject) {
    return this.fetchPath(`/zones/${this.segment(zoneId, "zoneId")}/workers/routes/${this.segment(routeId, "routeId")}`, {
      method: "PUT",
      body: this.requireObject(body, "route body"),
    });
  }

  deleteRoute(zoneId: string, routeId: string) {
    return this.fetchPath(`/zones/${this.segment(zoneId, "zoneId")}/workers/routes/${this.segment(routeId, "routeId")}`, { method: "DELETE" });
  }

  getAccountSettings() {
    return this.fetchPath(this.accountPath("/workers/account-settings"), { method: "GET" });
  }

  updateAccountSettings(body: JsonObject) {
    return this.fetchPath(this.accountPath("/workers/account-settings"), { method: "PATCH", body: this.requireObject(body, "account settings body") });
  }

  listBetaWorkers(query: QueryParams = {}) {
    return this.fetchPath(this.accountPath("/workers/workers"), { method: "GET", query });
  }

  createBetaWorker(body: JsonObject) {
    return this.fetchPath(this.accountPath("/workers/workers"), { method: "POST", body: this.requireObject(body, "worker body") });
  }

  getBetaWorker(workerId: string) {
    return this.fetchPath(this.accountPath(`/workers/workers/${this.segment(workerId, "workerId")}`), { method: "GET" });
  }

  deleteBetaWorker(workerId: string) {
    return this.fetchPath(this.accountPath(`/workers/workers/${this.segment(workerId, "workerId")}`), { method: "DELETE" });
  }

  listBetaVersions(workerId: string) {
    return this.fetchPath(this.accountPath(`/workers/workers/${this.segment(workerId, "workerId")}/versions`), { method: "GET" });
  }

  createBetaVersion(workerId: string, body: JsonObject) {
    return this.fetchPath(this.accountPath(`/workers/workers/${this.segment(workerId, "workerId")}/versions`), {
      method: "POST",
      body: this.requireObject(body, "version body"),
    });
  }

  getBetaVersion(workerId: string, versionId: string) {
    return this.fetchPath(this.accountPath(`/workers/workers/${this.segment(workerId, "workerId")}/versions/${this.segment(versionId, "versionId")}`), {
      method: "GET",
    });
  }

  rawRequest<T = unknown>(method: HttpMethod, path: string, options: Omit<CloudflareWorkersRequestOptions, "method"> = {}) {
    return this.fetchPath<T>(this.resolvePath(path), { ...options, method });
  }

  private async fetchPath<T>(path: string, options: CloudflareWorkersRequestOptions = {}): Promise<T> {
    const { method = "GET", body, headers = {}, query, rawBody = false, responseType = "json" } = options;
    const requestHeaders: Record<string, string> = {
      Accept: responseType === "json" ? "application/json" : "*/*",
      Authorization: `Bearer ${this.requireString(this.apiToken, "apiToken")}`,
      ...headers,
    };
    const init: RequestInit = { method, headers: requestHeaders };
    if (body !== undefined && method !== "GET") {
      if (rawBody) {
        init.body = this.toRawBody(body);
      } else {
        requestHeaders["Content-Type"] = requestHeaders["Content-Type"] || "application/json";
        init.body = JSON.stringify(this.clean(body));
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.buildUrl(path, query), {
        ...init,
        signal: options.signal || controller.signal,
      });
      if (responseType === "arrayBuffer") {
        if (!response.ok) throw new CloudflareWorkersApiError(await this.errorFromResponse(response), response.status);
        return { status: response.status, headers: this.headersToObject(response.headers), body: await response.arrayBuffer() } as T;
      }
      const text = await response.text();
      if (responseType === "text") {
        if (!response.ok) throw new CloudflareWorkersApiError(this.errorMessage(this.parseBody(text, response.headers.get("content-type")), response.statusText, response.status), response.status);
        return text as T;
      }
      const data = this.parseBody(text, response.headers.get("content-type"));
      if (!response.ok) throw new CloudflareWorkersApiError(this.errorMessage(data, response.statusText, response.status), response.status, data);
      if (data && typeof data === "object" && (data as Record<string, unknown>).success === false) {
        throw new CloudflareWorkersApiError(this.errorMessage(data, "Cloudflare Workers request failed", response.status), response.status, data);
      }
      return data as T;
    } catch (err) {
      if (err instanceof CloudflareWorkersApiError) throw err;
      if (err instanceof DOMException && err.name === "AbortError") throw new CloudflareWorkersApiError("Cloudflare Workers request timed out");
      throw new CloudflareWorkersApiError(`Cloudflare Workers network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private accountPath(path: string): string {
    return `/accounts/${encodeURIComponent(this.requireString(this.accountId, "accountId"))}${path}`;
  }

  private scriptPath(scriptName: string): string {
    return this.accountPath(`/workers/scripts/${this.segment(scriptName, "scriptName")}`);
  }

  private resolvePath(input: string): string {
    const raw = input.trim();
    if (!raw) throw new CloudflareWorkersApiError("Cloudflare Workers request path is required.");
    if (/^https?:\/\//i.test(raw)) throw new CloudflareWorkersApiError("Cloudflare Workers paths must be relative.");
    const path = raw.startsWith("/") ? raw : `/${raw}`;
    if (/[?#]/.test(path) || /(^|\/)\.\.?(\/|$)|%2e|%2f/i.test(path)) {
      throw new CloudflareWorkersApiError("Cloudflare Workers path must not contain query strings, fragments, or traversal.");
    }
    const accountWorkers = /^\/accounts\/[^/]+\/workers(?:\/(?:subdomain|account-settings|domains(?:\/[^/]+)?|scripts(?:\/[^/]+(?:\/(?:assets(?:\/upload)?|subdomain|schedules|tails(?:\/[^/]+)?|content|settings|deployments(?:\/[^/]+)?|versions(?:\/[^/]+)?|secrets(?:\/[^/]+)?|script-settings|version-settings))?)?|workers(?:\/[^/]+(?:\/versions(?:\/[^/]+)?)?)?|observability(?:\/[^/]+)*))?\/?$/;
    const zoneRoutes = /^\/zones\/[^/]+\/workers\/routes(?:\/[^/]+)?\/?$/;
    if (!accountWorkers.test(path) && !zoneRoutes.test(path)) throw new CloudflareWorkersApiError(`Raw Cloudflare Workers path is not allowed: ${path}`);
    return path.replace(/\/$/, "");
  }

  private buildUrl(path: string, query?: QueryParams): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) this.appendQuery(url, key, value);
    }
    return url.toString();
  }

  private appendQuery(url: URL, key: string, value: QueryValue | QueryValue[]): void {
    if (Array.isArray(value)) {
      for (const item of value) this.appendQueryValue(url, key, item);
      return;
    }
    this.appendQueryValue(url, key, value);
  }

  private appendQueryValue(url: URL, key: string, value: QueryValue): void {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.append(key, value instanceof Date ? value.toISOString() : String(value));
  }

  private toRawBody(body: RequestBody): BodyInit {
    if (body instanceof FormData) return body;
    if (body instanceof Uint8Array) return new Uint8Array(body).buffer as ArrayBuffer;
    if (typeof body === "string" || body instanceof Blob || body instanceof ArrayBuffer) return body;
    return JSON.stringify(this.clean(body));
  }

  private blobPart(value: string | Uint8Array | ArrayBuffer | Blob): BlobPart {
    if (value instanceof Uint8Array) return new Uint8Array(value).buffer as ArrayBuffer;
    return value;
  }

  private parseBody(text: string, contentType: string | null): unknown {
    if (!text) return {};
    if (contentType?.includes("json") || text.trim().startsWith("{") || text.trim().startsWith("[")) {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return { raw: text };
      }
    }
    return { raw: text };
  }

  private async errorFromResponse(response: Response): Promise<string> {
    const text = await response.text();
    return this.errorMessage(this.parseBody(text, response.headers.get("content-type")), response.statusText, response.status);
  }

  private errorMessage(data: unknown, statusText: string, status: number): string {
    if (data && typeof data === "object") {
      const record = data as Record<string, unknown>;
      const errors = record.errors;
      if (Array.isArray(errors) && errors.length > 0) {
        const messages = errors.map((error) => typeof error === "object" && error ? (error as Record<string, unknown>).message : error).filter(Boolean);
        if (messages.length > 0) return `Cloudflare Workers: ${messages.join(", ")}`;
      }
      for (const key of ["message", "error", "detail", "title"]) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) return `Cloudflare Workers: ${value}`;
      }
    }
    return `Cloudflare Workers request failed (${status}${statusText ? ` ${statusText}` : ""})`;
  }

  private headersToObject(headers: Headers): Record<string, string> {
    const output: Record<string, string> = {};
    headers.forEach((value, key) => {
      output[key] = value;
    });
    return output;
  }

  private clean(value: unknown): unknown {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map((item) => this.clean(item));
    if (value && typeof value === "object" && !(value instanceof Blob) && !(value instanceof ArrayBuffer) && !(value instanceof Uint8Array) && !(value instanceof FormData)) {
      const output: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        if (item !== undefined) output[key] = this.clean(item);
      }
      return output;
    }
    return value;
  }

  private cleanBaseUrl(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) throw new CloudflareWorkersApiError("Cloudflare base URL is required.");
    const url = new URL(trimmed);
    if (url.protocol !== "https:") throw new CloudflareWorkersApiError("Cloudflare base URL must use https.");
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  }

  private segment(value: string, label: string): string {
    return encodeURIComponent(this.requireString(value, label));
  }

  private requireObject(body: JsonObject, label: string): JsonObject {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length === 0) {
      throw new CloudflareWorkersApiError(`Cloudflare Workers ${label} must be a non-empty JSON object.`);
    }
    return body;
  }

  private requireString(value: string | undefined, label: string): string {
    const trimmed = value?.trim();
    if (!trimmed) throw new CloudflareWorkersApiError(`Cloudflare Workers ${label} is required.`);
    return trimmed;
  }
}

export { CloudflareWorkersClient as CloudflareWorkers };
