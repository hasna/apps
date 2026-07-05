import type { WorkOSConfig } from '../types';
import { WorkOSApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.workos.com';

export class WorkOSClient {
  private readonly apiKey: string;
  readonly baseUrl: string;

  constructor(config: WorkOSConfig) {
    if (!config.apiKey) {
      throw new Error('WorkOS apiKey is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || process.env.WORKOS_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  async request<T>(
    path: string,
    options: {
      method?: string;
      body?: Record<string, unknown>;
      params?: Record<string, string | number | string[] | undefined>;
    } = {},
  ): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          for (const item of value) {
            url.searchParams.append(key, String(item));
          }
        } else {
          url.searchParams.append(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) {
      return {} as T;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = data as { message?: string; error?: string; code?: string };
      throw new WorkOSApiError(
        err.message || err.error || response.statusText,
        response.status,
        err.code,
      );
    }

    return data as T;
  }
}
