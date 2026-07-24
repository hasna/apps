import type { TextItConfig } from "../types";
import { TextItApiError } from "../types";

const DEFAULT_BASE_URL = "https://textit.com/api/v2";

export function jsonPath(resource: string): string {
  const trimmed = resource.replace(/^\/+/, "");
  return trimmed.endsWith(".json") ? `/${trimmed}` : `/${trimmed}.json`;
}

export class TextItClient {
  private readonly apiToken: string;
  private readonly baseUrl: string;
  private readonly tokenPrefix: string;

  constructor(config: TextItConfig) {
    if (!config.apiToken) {
      throw new Error("TextIt apiToken is required");
    }
    this.apiToken = config.apiToken;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.tokenPrefix = config.tokenPrefix || "Token";
  }

  private authHeader(): string {
    return `${this.tokenPrefix} ${this.apiToken}`.trim();
  }

  async request<T>(
    resource: string,
    options: {
      method?: string;
      body?: Record<string, unknown>;
      params?: Record<string, string | number | boolean | undefined>;
    } = {},
  ): Promise<T> {
    const { method = "GET", body, params } = options;
    const url = new URL(`${this.baseUrl}${jsonPath(resource)}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.append(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: this.authHeader(),
      Accept: "application/json",
    };

    const fetchOptions: RequestInit = { method, headers };

    if (body && ["POST", "PUT", "PATCH"].includes(method)) {
      headers["Content-Type"] = "application/json";
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

    const text = await response.text();
    let data: unknown = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { detail: text };
      }
    }

    if (!response.ok) {
      const err = data as { detail?: string; message?: string };
      const message = err.detail || err.message || response.statusText || "Request failed";
      throw new TextItApiError(message, response.status);
    }

    return data as T;
  }

  async rawRequest<T>(
    path: string,
    options: {
      method?: string;
      body?: Record<string, unknown>;
      params?: Record<string, string | number | boolean | undefined>;
    } = {},
  ): Promise<T> {
    return this.request<T>(path, options);
  }
}
