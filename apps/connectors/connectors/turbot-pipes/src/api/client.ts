import type { TurbotPipesConfig } from '../types';
import { TurbotPipesApiError } from '../types';

const BASE_URL = 'https://pipes.turbot.com/api/latest';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[];
}

export function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment);
}

export class TurbotPipesClient {
  private readonly apiToken: string;
  private readonly baseUrl: string;

  constructor(config: TurbotPipesConfig, baseUrl: string = BASE_URL) {
    if (!config.apiToken) {
      throw new Error('API token is required');
    }
    this.apiToken = config.apiToken;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  workspacePath(orgHandle: string, workspaceHandle: string): string {
    return `/org/${encodePathSegment(orgHandle)}/workspace/${encodePathSegment(workspaceHandle)}`;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body } = options;
    const url = this.buildUrl(path, params);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiToken}`,
      Accept: 'application/json',
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      headers['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = { method, headers };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = JSON.stringify(body);
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
      const errorData = data as { error?: string; message?: string } | undefined;
      const message = errorData?.error || errorData?.message || response.statusText;
      throw new TurbotPipesApiError(message, response.status, data);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown>, params });
  }
}
