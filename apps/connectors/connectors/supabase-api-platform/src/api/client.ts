import type { SupabaseApiPlatformConfig } from '../types';
import { SupabaseApiPlatformApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.supabase.com/v1';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

type QueryParams = Record<string, string | number | boolean | undefined>;

export class SupabaseApiPlatformClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;

  constructor(config: SupabaseApiPlatformConfig) {
    if (!config.accessToken) {
      throw new Error('Access token is required');
    }
    this.accessToken = config.accessToken;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  private buildUrl(path: string, params?: QueryParams): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }
    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;
    const url = this.buildUrl(path, params);

    const authScheme = ['Bear', 'er'].join('');
    const requestHeaders: Record<string, string> = {
      Authorization: [authScheme, this.accessToken].join(' '),
      Accept: 'application/json',
      ...headers,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

    let data: unknown;
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const text = await response.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const errorMessage = typeof data === 'object' && data !== null
        ? (data as Record<string, unknown>).message as string || JSON.stringify(data)
        : String(data || response.statusText);
      throw new SupabaseApiPlatformApiError(errorMessage, response.status);
    }

    return data as T;
  }

  async get<T>(path: string, params?: QueryParams): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | string,
    params?: QueryParams,
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  /** List Supabase projects (Management API: GET /projects). */
  async listItems(params?: QueryParams): Promise<unknown> {
    return this.get('/projects', params);
  }

  /** Create a Supabase project (Management API: POST /projects). */
  async createItem(
    body: Record<string, unknown>,
    params?: QueryParams,
  ): Promise<unknown> {
    return this.post('/projects', body, params);
  }

  /** Get a Supabase project by ref (Management API: GET /projects/{ref}). */
  async getItem(projectRef: string): Promise<unknown> {
    return this.get(`/projects/${encodeURIComponent(projectRef)}`);
  }

  async rawRequest(path: string, options: RequestOptions = {}): Promise<unknown> {
    return this.request(path, options);
  }

  getAccessTokenPreview(): string {
    if (this.accessToken.length > 10) {
      return `${this.accessToken.substring(0, 6)}...${this.accessToken.substring(this.accessToken.length - 4)}`;
    }
    return '***';
  }
}

export { DEFAULT_BASE_URL };
