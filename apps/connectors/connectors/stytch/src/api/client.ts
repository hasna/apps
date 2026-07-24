import type { StytchConfig, StytchEnvironment } from '../types';
import { StytchApiError } from '../types';

const ENV_BASES: Record<StytchEnvironment, string> = {
  live: 'https://api.stytch.com',
  test: 'https://test.stytch.com',
};

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
}

export class StytchClient {
  private readonly projectId: string;
  private readonly secret: string;
  readonly baseUrl: string;

  constructor(config: StytchConfig) {
    if (!config.projectId?.trim() || !config.secret?.trim()) {
      throw new Error('Stytch projectId and secret are required');
    }
    const environment = (config.environment ?? 'live').toLowerCase() as StytchEnvironment;
    const base = ENV_BASES[environment];
    if (!base) {
      throw new Error(`Stytch environment must be one of: ${Object.keys(ENV_BASES).join(', ')}`);
    }
    this.projectId = config.projectId.trim();
    this.secret = config.secret.trim();
    this.baseUrl = `${base}/v1`;
  }

  getEnvironment(): StytchEnvironment {
    return this.baseUrl.includes('test.stytch.com') ? 'test' : 'live';
  }

  getAuthHeader(): string {
    const credentials = Buffer.from(`${this.projectId}:${this.secret}`).toString('base64');
    return `Basic ${credentials}`;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = this.buildUrl(path, params);
    const headers: Record<string, string> = {
      Authorization: this.getAuthHeader(),
      Accept: 'application/json',
    };
    if (body !== undefined && ['POST', 'PUT', 'PATCH'].includes(method)) {
      headers['Content-Type'] = 'application/json';
    }
    const fetchOptions: RequestInit = { method, headers };
    if (body !== undefined && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = JSON.stringify(body);
    }
    const response = await fetch(url, fetchOptions);
    if (response.status === 204) return {} as T;
    const text = await response.text();
    let data: unknown = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }
    if (!response.ok) {
      const record = data as { error_message?: string; error_type?: string; request_id?: string };
      throw new StytchApiError(
        record.error_message || record.error_type || response.statusText,
        response.status,
        record.error_type,
        record.request_id,
      );
    }
    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body });
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }
}

export { ENV_BASES };
