import type { ConnectorConfig, HttpMethod } from '../types';
import { ConnectorApiError } from '../types';

// Default Syntropy API base URL. Override per-request via the base_url credential.
export const DEFAULT_BASE_URL = 'https://api.syntropy.io/v1';

export interface RequestOptions {
  method?: HttpMethod;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

/**
 * Low-level HTTP client for the Syntropy REST API.
 * Handles URL building, Bearer auth, JSON encoding, timeouts, and error checking.
 */
export class ConnectorClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: ConnectorConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    // Strip any trailing slashes so path joining is predictable.
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  /**
   * Build a full Syntropy API URL for a given path and optional query params.
   */
  buildUrl(path: string, query?: RequestOptions['query']): string {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    const url = `${this.baseUrl}${normalized}`;
    if (!query) return url;

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        params.append(key, String(value));
      }
    }
    const qs = params.toString();
    return qs ? `${url}?${qs}` : url;
  }

  private buildInit(method: HttpMethod, body?: unknown): RequestInit {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      'User-Agent': 'connect-syntropy/0.1.0',
    };
    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(15000),
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return init;
  }

  /**
   * Make an authenticated request to the Syntropy API.
   * Returns parsed JSON on success, throws ConnectorApiError on HTTP error,
   * or returns { stub: true } when the API is unreachable (network failure).
   */
  async request<T>(
    path: string,
    options: RequestOptions = {}
  ): Promise<{ data: T; stub: false } | { data: null; stub: true }> {
    const method = options.method ?? 'GET';
    const url = this.buildUrl(path, options.query);

    try {
      const response = await fetch(url, this.buildInit(method, options.body));

      if (!response.ok) {
        throw new ConnectorApiError(
          `Syntropy API ${method} ${path} failed with status ${response.status}`,
          response.status,
          await response.text()
        );
      }

      const text = await response.text();
      const data = (text ? JSON.parse(text) : null) as T;
      return { data, stub: false };
    } catch (error) {
      if (error instanceof ConnectorApiError) throw error;
      // API unreachable — return stub indicator
      return { data: null, stub: true };
    }
  }

  /**
   * Make a raw authenticated request that surfaces the HTTP status/body without
   * throwing on non-2xx responses. Used by the `raw` escape hatch so callers can
   * inspect arbitrary Syntropy endpoints. Returns { stub: true } on network failure.
   */
  async rawRequest(
    method: HttpMethod,
    path: string,
    options: Omit<RequestOptions, 'method'> = {}
  ): Promise<{ status: number; ok: boolean; data: unknown; stub: boolean }> {
    const url = this.buildUrl(path, options.query);

    try {
      const response = await fetch(url, this.buildInit(method, options.body));
      const text = await response.text();
      let data: unknown = text || null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          // Non-JSON body — keep the raw text.
        }
      }
      return { status: response.status, ok: response.ok, data, stub: false };
    } catch {
      return { status: 0, ok: false, data: null, stub: true };
    }
  }

  /**
   * Get a preview of the API key (for display/debugging)
   */
  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }

  /**
   * Get the resolved base URL in use.
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }
}
