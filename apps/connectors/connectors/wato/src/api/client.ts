import type { WatoConfig } from '../types';
import { WatoApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.watolabs.com/v1';

export class WatoClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: WatoConfig) {
    if (!config.apiKey) throw new Error('Wato apiKey is required');
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  encodePathSegment(segment: string): string {
    return encodeURIComponent(segment);
  }

  async request<T>(
    path: string,
    options: {
      method?: string;
      body?: Record<string, unknown>;
      params?: Record<string, string | number | boolean | undefined>;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const { method = 'GET', body, params, headers = {} } = options;
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      ...headers,
    };

    const fetchOptions: RequestInit = { method, headers: requestHeaders };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), fetchOptions);

    if (response.status === 204) return {} as T;

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new WatoApiError(
        (data as { message?: string })?.message || response.statusText,
        response.status,
      );
    }

    return data as T;
  }
}
