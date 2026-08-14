import type { HttpMethod, JsonObject, JsonValue, QueryValue, RequestOptions, ZoomInfoConfig } from "../types";
import { ZoomInfoApiError } from "../types";

const DEFAULT_BASE_URL = "https://api.zoominfo.com";

export class ZoomInfoClient {
  private readonly username?: string;
  private readonly password?: string;
  private readonly configuredJwt?: string;
  private readonly baseUrl: string;
  private cachedJwt?: string;

  constructor(config: ZoomInfoConfig = {}) {
    this.username = config.username;
    this.password = config.password;
    this.configuredJwt = config.jwt;
    this.baseUrl = this.cleanBaseUrl(config.baseUrl || DEFAULT_BASE_URL);
  }

  async authenticate(): Promise<{ jwt: string }> {
    const username = this.requireString(this.username, "username");
    const password = this.requireString(this.password, "password");

    const response = await fetch(`${this.baseUrl}/authenticate`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
    });

    const text = await response.text();
    const data = this.parseResponseBody(text, response.headers.get("content-type"));

    if (!response.ok) {
      throw new ZoomInfoApiError(this.errorMessage(data, response.statusText), response.status, data);
    }

    const jwt = this.extractJwt(data);
    this.cachedJwt = jwt;
    return { jwt };
  }

  async searchContacts(body: JsonValue = {}, params: Record<string, QueryValue> = {}) {
    return this.request("/search/contact", { method: "POST", params, body });
  }

  async searchCompanies(body: JsonValue = {}, params: Record<string, QueryValue> = {}) {
    return this.request("/search/company", { method: "POST", params, body });
  }

  async enrichContact(body: JsonValue) {
    this.requireMatchPersonInput(body);
    return this.request("/enrich/contact", { method: "POST", body });
  }

  async enrichCompany(body: JsonValue = {}) {
    return this.request("/enrich/company", { method: "POST", body });
  }

  async lookupContact(contactId: string) {
    return this.request(`/lookup/contact/${this.segment(contactId)}`);
  }

  async listContactSearchOutputFields() {
    return this.request("/lookup/outputfields/contact/search");
  }

  async listCompanySearchOutputFields() {
    return this.request("/lookup/outputfields/company/search");
  }

  rawRequest<T = unknown>(method: HttpMethod, path: string, options: Omit<RequestOptions, "method"> = {}) {
    return this.request<T>(path, { ...options, method });
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method || "GET";
    const url = this.buildUrl(path, options.params);
    const headers = await this.prepareHeaders(options);
    const body = this.prepareBody(method, options.body, headers);

    const response = await fetch(url.toString(), {
      method,
      headers,
      body,
    });
    const text = await response.text();
    const data = options.responseType === "text" ? text : this.parseResponseBody(text, response.headers.get("content-type"));

    if (!response.ok) {
      throw new ZoomInfoApiError(this.errorMessage(data, response.statusText), response.status, data);
    }

    return data as T;
  }

  private async prepareHeaders(options: RequestOptions): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...options.headers,
    };

    if (options.auth !== false) {
      const jwt = await this.resolveJwt();
      headers.Authorization = `Bearer ${jwt}`;
    }

    return headers;
  }

  private async resolveJwt(): Promise<string> {
    if (this.configuredJwt) {
      return this.configuredJwt;
    }
    if (this.cachedJwt) {
      return this.cachedJwt;
    }
    const result = await this.authenticate();
    return result.jwt;
  }

  private extractJwt(data: unknown): string {
    if (typeof data === "object" && data !== null) {
      const record = data as Record<string, unknown>;
      for (const key of ["jwt", "access_token", "token"]) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
      }
    }
    throw new ZoomInfoApiError("ZoomInfo authenticate response did not include a JWT");
  }

  private requireMatchPersonInput(body: JsonValue): void {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new Error("ZoomInfo enrichContact body must be a JSON object with matchPersonInput");
    }
    const matchPersonInput = (body as JsonObject).matchPersonInput;
    if (!Array.isArray(matchPersonInput) || matchPersonInput.length === 0) {
      throw new Error("ZoomInfo enrichContact requires matchPersonInput");
    }
  }

  private prepareBody(method: HttpMethod, body: JsonValue | string | undefined, headers: Record<string, string>): string | undefined {
    if (body === undefined || body === null || method === "GET") return undefined;
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
    return typeof body === "string" ? body : JSON.stringify(this.cleanObject(body));
  }

  private buildUrl(path: string, params?: Record<string, QueryValue>): URL {
    const trimmedPath = path.trim();
    if (!trimmedPath) throw new Error("ZoomInfo API path is required");
    if (/^https?:\/\//i.test(trimmedPath)) throw new Error("ZoomInfo raw paths must be relative, not absolute URLs");
    if (trimmedPath.includes("..")) throw new Error("ZoomInfo raw paths must not contain path traversal");

    const normalizedPath = trimmedPath.startsWith("/") ? trimmedPath : `/${trimmedPath}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) this.appendQueryValue(url, key, value);
    }
    return url;
  }

  private appendQueryValue(url: URL, key: string, value: QueryValue): void {
    if (value === undefined || value === null || value === "") return;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
      return;
    }
    url.searchParams.append(key, String(value));
  }

  private parseResponseBody(text: string, contentType: string | null): unknown {
    if (!text) return {};
    if (contentType?.includes("json") || text.startsWith("{") || text.startsWith("[")) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    return text;
  }

  private errorMessage(data: unknown, statusText: string): string {
    if (typeof data === "object" && data !== null) {
      const record = data as Record<string, unknown>;
      if (typeof record.error_message === "string") return record.error_message;
      if (typeof record.error === "string") return record.error;
      if (typeof record.message === "string") return record.message;
    }
    if (typeof data === "string" && data.trim()) return data.slice(0, 500);
    return statusText || "ZoomInfo API request failed";
  }

  private cleanBaseUrl(baseUrl: string): string {
    const trimmed = baseUrl.trim();
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return withProtocol.replace(/\/+$/, "");
  }

  private segment(value: string): string {
    return encodeURIComponent(this.requireString(value, "path segment"));
  }

  private requireString(value: string | undefined, label: string): string {
    const trimmed = value?.trim();
    if (!trimmed) throw new Error(`ZoomInfo ${label} is required`);
    return trimmed;
  }

  private cleanObject(value: JsonValue): JsonValue {
    if (Array.isArray(value)) return value.map((item) => this.cleanObject(item));
    if (typeof value !== "object" || value === null) return value;
    const cleaned: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined) cleaned[key] = this.cleanObject(child);
    }
    return cleaned;
  }
}
