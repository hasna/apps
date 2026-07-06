import type { TinybirdConfig, TinybirdApiErrorBody } from '../types';
import { TinybirdApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.tinybird.co';

export interface TinybirdRequestOptions {
  method?: string;
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Skip default JSON Content-Type (e.g. for NDJSON ingest). */
  skipJsonContentType?: boolean;
  /** Return raw text instead of parsing JSON. */
  rawText?: boolean;
}

export class TinybirdClient {
  private readonly apiToken: string;
  readonly baseUrl: string;

  constructor(config: TinybirdConfig) {
    if (!config.apiToken) {
      throw new Error('Tinybird API token is required');
    }
    this.apiToken = config.apiToken;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  getApiToken(): string {
    return this.apiToken;
  }

  private buildQuery(params?: Record<string, string | number | boolean | undefined>): string {
    if (!params) return '';
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') continue;
      query.set(key, String(value));
    }
    const text = query.toString();
    return text ? `?${text}` : '';
  }

  async request<T = unknown>(path: string, options: TinybirdRequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, skipJsonContentType, rawText } = options;
    const url = `${this.baseUrl}${path}${this.buildQuery(params)}`;

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.apiToken}`,
      ...headers,
    };

    const fetchOptions: RequestInit = { method, headers: requestHeaders };

    if (body !== undefined && body !== null) {
      if (typeof body === 'string') {
        fetchOptions.body = body;
        if (!skipJsonContentType && !requestHeaders['Content-Type']) {
          requestHeaders['Content-Type'] = 'application/json';
        }
      } else if (body instanceof URLSearchParams) {
        fetchOptions.body = body.toString();
        requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
      } else {
        fetchOptions.body = JSON.stringify(body);
        if (!skipJsonContentType) {
          requestHeaders['Content-Type'] = 'application/json';
        }
      }
    }

    const response = await fetch(url, fetchOptions);
    const text = await response.text();

    if (!response.ok) {
      let message = `Tinybird API error: ${response.status} ${response.statusText}`;
      try {
        const data = JSON.parse(text) as TinybirdApiErrorBody;
        message = data.error || data.message || message;
      } catch {
        if (text) message = text;
      }
      throw new TinybirdApiError(message, response.status);
    }

    if (rawText || response.status === 204) {
      return (text || {}) as T;
    }

    if (!text) return {} as T;

    try {
      return JSON.parse(text) as T;
    } catch {
      return { raw: text } as T;
    }
  }

  /** POST datasource create/append with query-string form params (Tinybird API convention). */
  async postDataSourceForm(params: URLSearchParams): Promise<unknown> {
    const url = `${this.baseUrl}/v0/datasources?${params.toString()}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });
    const text = await response.text();
    let data: unknown = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!response.ok) {
      const record = data as TinybirdApiErrorBody;
      throw new TinybirdApiError(record.error || `request failed (${response.status})`, response.status);
    }
    return data;
  }
}
