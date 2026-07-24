import type { HttpMethod, JsonObject, QueryParams, QueryValue, RequestOptions, ZoomApiConfig } from "../types";
import { ZoomApiApiError } from "../types";

const DEFAULT_BASE_URL = "https://api.zoomapi.com/v1";
const RAW_PATH_PATTERN = /^\/(?:items|events|search)(?:\/|$)/;

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Zoom Api ${label} is required`);
  }
  return value.trim();
}

function requireBody(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Zoom Api ${label} must be a JSON object`);
  }
  return value as JsonObject;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("Zoom Api base URL must use https");
  }
  return url.toString().replace(/\/+$/, "");
}

function normalizePath(path: string): string {
  const text = path.trim();
  if (!text) {
    throw new Error("Zoom Api API path is required");
  }
  if (/^https?:\/\//i.test(text)) {
    throw new Error("Zoom Api API paths must be relative, not absolute URLs");
  }
  const normalized = text.startsWith("/") ? text : `/${text}`;
  if (normalized.split("/").some((part) => part === "..")) {
    throw new Error("Zoom Api API paths cannot contain parent-directory segments");
  }
  if (!/^\/[A-Za-z0-9._~!$&'()*+,;=:@/%-]+$/.test(normalized)) {
    throw new Error("Zoom Api API path contains unsupported characters");
  }
  return normalized;
}

function pathPart(value: string | number): string {
  return encodeURIComponent(String(value));
}

function appendQueryValue(params: URLSearchParams, key: string, value: QueryValue): void {
  if (value === undefined || value === null || value === "") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== undefined && item !== null && item !== "") {
        params.append(key, String(item));
      }
    }
    return;
  }
  params.append(key, String(value));
}

function appendQuery(url: URL, query?: QueryParams): void {
  if (!query) {
    return;
  }
  for (const [key, value] of Object.entries(query)) {
    appendQueryValue(url.searchParams, key, value);
  }
}

function parseResponseBody(text: string, contentType: string | null): unknown {
  if (!text) {
    return {};
  }
  if (contentType?.includes("json") || text.startsWith("{") || text.startsWith("[")) {
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }
  return text;
}

function extractMessage(data: unknown, fallback: string): string {
  if (typeof data === "string" && data.trim()) {
    return data.slice(0, 500);
  }
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const candidate = record.message ?? record.error ?? record.errors ?? record.detail ?? record.title;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
    if (Array.isArray(candidate)) {
      return JSON.stringify(candidate);
    }
  }
  return fallback;
}

export class ZoomApiClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;

  constructor(config: ZoomApiConfig = {}) {
    this.apiKey = config.apiKey;
    this.baseUrl = normalizeBaseUrl(config.baseUrl || DEFAULT_BASE_URL);
  }

  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method || (options.body === undefined ? "GET" : "POST");
    const url = new URL(`${this.baseUrl}${normalizePath(path)}`);
    appendQuery(url, options.query);

    const headers: Record<string, string> = {
      Accept: "application/json",
      ...options.headers,
    };
    if (options.auth !== false) {
      headers.Authorization = `Bearer ${this.requireApiKey()}`;
    }
    const body = this.prepareBody(method, options.body, headers);
    const response = await fetch(url.toString(), { method, headers, body });
    const text = await response.text();
    const data = parseResponseBody(text, response.headers.get("content-type"));

    if (!response.ok) {
      throw new ZoomApiApiError(
        extractMessage(data, response.statusText || `Zoom Api request failed with ${response.status}`),
        response.status,
        data,
      );
    }

    return data as T;
  }

  listItems<T = unknown>(options: { query?: QueryParams } = {}): Promise<T> {
    return this.request<T>("/items", { query: options.query });
  }

  createItem<T = unknown>(body: JsonObject): Promise<T> {
    return this.request<T>("/items", { method: "POST", body: requireBody(body, "item body") });
  }

  getItem<T = unknown>(itemId: string | number): Promise<T> {
    return this.request<T>(`/items/${pathPart(requireText(String(itemId), "itemId"))}`);
  }

  listEvents<T = unknown>(options: { query?: QueryParams } = {}): Promise<T> {
    return this.request<T>("/events", { query: options.query });
  }

  search<T = unknown>(body: JsonObject): Promise<T> {
    return this.request<T>("/search", { method: "POST", body: requireBody(body, "search body") });
  }

  rawRequest<T = unknown>(method: HttpMethod, path: string, options: Omit<RequestOptions, "method"> = {}): Promise<T> {
    const normalized = normalizePath(path);
    if (!RAW_PATH_PATTERN.test(normalized)) {
      throw new Error("Zoom Api raw requests are limited to /items, /events, and /search API paths.");
    }
    return this.request<T>(normalized, { ...options, method });
  }

  private requireApiKey(): string {
    const apiKey = this.apiKey?.trim();
    if (!apiKey) {
      throw new Error("Zoom Api API key is required");
    }
    return apiKey;
  }

  private prepareBody(method: HttpMethod, body: RequestOptions["body"], headers: Record<string, string>): BodyInit | undefined {
    if (method === "GET" || body === undefined) {
      return undefined;
    }
    if (typeof body === "string") {
      headers["Content-Type"] ||= "text/plain";
      return body;
    }
    headers["Content-Type"] ||= "application/json";
    return JSON.stringify(body);
  }
}
