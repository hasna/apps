import type { UpdownIoConfig } from "../types";
import { UpdownIoApiError } from "../types";

const DEFAULT_BASE_URL = "https://updown.io/api";

export class UpdownIoClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: UpdownIoConfig) {
    if (!config.apiKey) throw new Error("updown.io apiKey is required");
    this.apiKey = config.apiKey;
    this.baseUrl = DEFAULT_BASE_URL;
  }

  async request<T>(
    path: string,
    options: {
      method?: string;
      params?: Record<string, string | number | boolean | undefined>;
      textResponse?: boolean;
      requireAuth?: boolean;
    } = {},
  ): Promise<T> {
    const { method = "GET", params, textResponse = false, requireAuth = true } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== "") {
          url.searchParams.append(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Accept: textResponse ? "text/plain" : "application/json",
    };
    if (requireAuth) {
      headers["X-API-KEY"] = this.apiKey;
    }

    const response = await fetch(url.toString(), { method, headers });
    if (response.status === 204) return {} as T;

    if (textResponse || (response.headers.get("content-type") || "").includes("text/plain")) {
      const text = await response.text();
      if (!response.ok) {
        throw new UpdownIoApiError(text || response.statusText, response.status);
      }
      return text as T;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        (typeof data === "object" && data !== null && "error" in data
          ? String((data as { error?: string }).error)
          : undefined) || response.statusText;
      throw new UpdownIoApiError(message, response.status);
    }
    return data as T;
  }
}

export function encodePathToken(token: string): string {
  return encodeURIComponent(token);
}
