import { TakeCareOSApiError, type TakeCareOSConfig } from "../types/index";

const DEFAULT_BASE_URL = "https://api.takecareos.com/v1";

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  params?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
}

/**
 * Minimal TakeCareOS transport — raw fetch, no persistence.
 *
 * Authentication is a Bearer API key sent on every request. The base URL is
 * overridable (config.baseUrl) so agencies on a dedicated/regional host can
 * point the client at their own endpoint without code changes.
 */
export class TakeCareOSClientTransport {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: TakeCareOSConfig) {
    if (!config?.apiKey) {
      throw new Error("TakeCareOS API key is required");
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = "GET", params, body } = options;

    const url = new URL(`${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.append(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
    };

    const init: RequestInit = { method, headers };
    if (body !== undefined && method !== "GET") {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), init);

    if (response.status === 204) return {} as T;

    let data: unknown;
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const errBody = (typeof data === "object" && data !== null ? data : {}) as {
        error?: string | { message?: string; code?: string };
        message?: string;
        code?: string;
      };
      const nested = typeof errBody.error === "object" ? errBody.error : undefined;
      const message =
        nested?.message ||
        errBody.message ||
        (typeof errBody.error === "string" ? errBody.error : undefined) ||
        response.statusText ||
        "Request failed";
      const code = nested?.code || errBody.code;
      throw new TakeCareOSApiError(message, response.status, code);
    }

    return data as T;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
