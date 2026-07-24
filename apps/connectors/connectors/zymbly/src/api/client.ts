import type {
  HttpMethod,
  JsonObject,
  QueryParams,
  RequestOptions,
  ZymblyConfig,
} from "../types";
import { ZymblyApiError } from "../types";

const DEFAULT_BASE_URL = "https://api.zymbly.com/v1";

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error("Zymbly API path is required");
  }
  if (/^https?:\/\//i.test(trimmed)) {
    throw new Error("Zymbly API paths must be relative, not absolute URLs");
  }
  const normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (normalized.split("/").some((part) => part === "..")) {
    throw new Error("Zymbly API paths cannot contain parent-directory segments");
  }
  return normalized;
}

function encodePath(value: string | number): string {
  return encodeURIComponent(String(value));
}

function appendQuery(url: URL, query?: QueryParams): void {
  if (!query) {
    return;
  }
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) {
          url.searchParams.append(key, String(item));
        }
      }
      continue;
    }
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
}

function parseResponse(text: string, contentType: string | null): unknown {
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

function extractErrorMessage(data: unknown, fallback: string): string {
  if (typeof data === "string" && data.trim()) {
    return data.slice(0, 500);
  }
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const message = record.message ?? record.error ?? record.detail ?? record.title;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return fallback;
}

export class ZymblyClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;

  constructor(config: ZymblyConfig = {}) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method || (options.body ? "POST" : "GET");
    const url = this.buildUrl(path, options.query);
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...options.headers,
    };
    const body = this.prepareBody(method, options);
    if (body !== undefined && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    if (options.auth !== false) {
      headers.Authorization = `Bearer ${this.requireApiKey()}`;
    }
    const response = await fetch(url.toString(), { method, headers, body });
    const text = await response.text();
    const data = parseResponse(text, response.headers.get("content-type"));
    if (!response.ok) {
      throw new ZymblyApiError(
        extractErrorMessage(data, response.statusText || `Zymbly request failed with ${response.status}`),
        response.status,
        data,
      );
    }
    return data as T;
  }

  listWorkOrders<T = unknown>(query?: QueryParams): Promise<T> {
    return this.request<T>("/work-orders", { query });
  }

  getWorkOrder<T = unknown>(workOrderId: string): Promise<T> {
    return this.request<T>(`/work-orders/${encodePath(workOrderId)}`);
  }

  searchParts<T = unknown>(query?: QueryParams): Promise<T> {
    return this.request<T>("/parts", { query });
  }

  createMaintenanceNote<T = unknown>(workOrderId: string, note: string): Promise<T> {
    return this.request<T>(`/work-orders/${encodePath(workOrderId)}/notes`, {
      method: "POST",
      body: { note },
    });
  }

  createMaintenanceNoteWithBody<T = unknown>(workOrderId: string, body: JsonObject): Promise<T> {
    return this.request<T>(`/work-orders/${encodePath(workOrderId)}/notes`, {
      method: "POST",
      body,
    });
  }

  rawRequest<T = unknown>(method: HttpMethod, path: string, options: Omit<RequestOptions, "method"> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method });
  }

  private buildUrl(path: string, query?: QueryParams): URL {
    const url = new URL(`${this.baseUrl}${normalizePath(path)}`);
    appendQuery(url, query);
    return url;
  }

  private prepareBody(method: HttpMethod, options: RequestOptions): string | undefined {
    if (method === "GET") {
      return undefined;
    }
    if (options.body === undefined) {
      return undefined;
    }
    return typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }

  private requireApiKey(): string {
    if (!this.apiKey) {
      throw new Error("Zymbly API key is required. Use config set-key or set ZYMBLY_API_KEY.");
    }
    return this.apiKey;
  }
}
