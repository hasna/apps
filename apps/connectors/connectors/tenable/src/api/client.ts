import type { TenableConfig } from '../types';
import { TenableApiError } from '../types';

const DEFAULT_BASE_URL = 'https://cloud.tenable.com';

/**
 * Low-level HTTP client for the Tenable.io REST API.
 *
 * Authentication uses API keys passed in the `X-ApiKeys` header:
 *   X-ApiKeys: accessKey={accessKey};secretKey={secretKey}
 * (see https://developer.tenable.com/docs/authorization)
 */
export class TenableClient {
  private readonly authHeader: string;
  private readonly baseUrl: string;

  constructor(config: TenableConfig) {
    if (!config.accessKey || !config.secretKey) {
      throw new Error('Tenable accessKey and secretKey are required');
    }
    this.authHeader = `accessKey=${config.accessKey};secretKey=${config.secretKey}`;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  /** Build the fully-qualified request URL for a path (exposed for testing). */
  buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.append(key, String(value));
      }
    }
    return url.toString();
  }

  async request<T>(
    path: string,
    options: {
      method?: string;
      body?: Record<string, unknown>;
      params?: Record<string, string | number | boolean | undefined>;
    } = {},
  ): Promise<T> {
    const { method = 'GET', body, params } = options;
    const headers: Record<string, string> = {
      'X-ApiKeys': this.authHeader,
      Accept: 'application/json',
      'User-Agent': 'hasna-connect-tenable',
    };
    if (body) headers['Content-Type'] = 'application/json';

    const fetchOptions: RequestInit = { method, headers };
    if (body) fetchOptions.body = JSON.stringify(body);

    const response = await fetch(this.buildUrl(path, params), fetchOptions);
    if (response.status === 204) return {} as T;

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        (data as { error?: string; message?: string })?.error ||
        (data as { message?: string })?.message ||
        response.statusText;
      throw new TenableApiError(message, response.status);
    }
    return data as T;
  }
}
