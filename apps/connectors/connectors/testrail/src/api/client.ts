import type { TestRailConfig, TestRailError } from '../types';
import { TestRailApiError } from '../types';

export interface RequestOptions {
  method?: 'GET' | 'POST';
  params?: Record<string, string | number | boolean | number[] | undefined>;
  body?: Record<string, unknown> | unknown[] | object;
}

export class TestRailClient {
  private readonly email: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: TestRailConfig) {
    if (!config.email) {
      throw new Error('Email is required');
    }
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    if (!config.baseUrl) {
      throw new Error('Base URL is required');
    }
    this.email = config.email;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
  }

  private getAuthHeader(): string {
    const credentials = `${this.email}:${this.apiKey}`;
    const encoded = Buffer.from(credentials).toString('base64');
    return `Basic ${encoded}`;
  }

  /**
   * Build a TestRail API v2 URL.
   * Format: {base}/index.php?/api/v2/{method}[/{segment}...][&query=params]
   */
  buildMethodUrl(
    method: string,
    segments: Array<string | number> = [],
    params?: Record<string, string | number | boolean | number[] | undefined>
  ): string {
    let url = `${this.baseUrl}/index.php?/api/v2/${method}`;
    if (segments.length > 0) {
      url += `/${segments.map(String).join('/')}`;
    }
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        const serialized = Array.isArray(value) ? value.join(',') : String(value);
        url += `&${encodeURIComponent(key)}=${encodeURIComponent(serialized)}`;
      });
    }
    return url;
  }

  async request<T>(
    method: string,
    segments: Array<string | number> = [],
    options: RequestOptions = {}
  ): Promise<T> {
    const { method: httpMethod = 'GET', params, body } = options;
    const url = this.buildMethodUrl(method, segments, params);

    const headers: Record<string, string> = {
      Authorization: this.getAuthHeader(),
      Accept: 'application/json',
    };

    const fetchOptions: RequestInit = {
      method: httpMethod,
      headers,
    };

    if (body !== undefined && httpMethod === 'POST') {
      headers['Content-Type'] = 'application/json';
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
      const errorData = data as TestRailError | null;
      const errorMessage =
        errorData?.error ||
        (typeof data === 'string' && data ? data : response.statusText);
      throw new TestRailApiError(errorMessage, response.status, errorData || undefined);
    }

    return data as T;
  }

  async get<T>(
    method: string,
    segments: Array<string | number> = [],
    params?: Record<string, string | number | boolean | number[] | undefined>
  ): Promise<T> {
    return this.request<T>(method, segments, { method: 'GET', params });
  }

  async post<T>(
    method: string,
    segments: Array<string | number> = [],
    body?: Record<string, unknown> | unknown[] | object,
    params?: Record<string, string | number | boolean | number[] | undefined>
  ): Promise<T> {
    return this.request<T>(method, segments, { method: 'POST', body, params });
  }

  getEmailPreview(): string {
    const [local, domain] = this.email.split('@');
    if (local && domain) {
      return `${local.substring(0, 3)}...@${domain}`;
    }
    return '***@***';
  }
}
