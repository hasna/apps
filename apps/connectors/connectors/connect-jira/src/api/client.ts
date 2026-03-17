import type { JiraConfig, JiraError } from '../types';
import { JiraApiError } from '../types';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

export class JiraClient {
  private readonly email: string;
  private readonly apiToken: string;
  private readonly baseUrl: string;

  constructor(config: JiraConfig) {
    if (!config.email) {
      throw new Error('Email is required');
    }
    if (!config.apiToken) {
      throw new Error('API token is required');
    }
    if (!config.domain) {
      throw new Error('Domain is required');
    }
    this.email = config.email;
    this.apiToken = config.apiToken;
    this.baseUrl = config.baseUrl || `https://${config.domain}/rest/api/3`;
  }

  private getAuthHeader(): string {
    const credentials = `${this.email}:${this.apiToken}`;
    const encoded = Buffer.from(credentials).toString('base64');
    return `Basic ${encoded}`;
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

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'Authorization': this.getAuthHeader(),
      'Accept': 'application/json',
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
      const errorData = data as JiraError | null;
      const errorMessage = errorData?.errorMessages?.[0] ||
        (errorData?.errors ? Object.values(errorData.errors).join(', ') : '') ||
        response.statusText;
      throw new JiraApiError(errorMessage, response.status, errorData || undefined);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string | object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown>, params });
  }

  async put<T>(path: string, body?: Record<string, unknown> | object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: body as Record<string, unknown>, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  getEmailPreview(): string {
    const [local, domain] = this.email.split('@');
    if (local && domain) {
      return `${local.substring(0, 3)}...@${domain}`;
    }
    return '***@***';
  }
}
