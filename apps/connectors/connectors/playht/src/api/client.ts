import type { PlayHTConfig, OutputFormat } from '../types';
import { PlayHTApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.play.ht/api/v2';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  format?: OutputFormat;
  rawResponse?: boolean;
}

export class PlayHTClient {
  private readonly apiKey: string;
  private readonly userId: string;
  private readonly baseUrl: string;

  constructor(config: PlayHTConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    if (!config.userId) {
      throw new Error('User ID is required');
    }
    this.apiKey = config.apiKey;
    this.userId = config.userId;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
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
    const { method = 'GET', params, body, headers = {}, rawResponse = false } = options;

    const url = this.buildUrl(path, params);

    // PlayHT requires both Authorization and X-USER-ID headers
    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'X-USER-ID': this.userId,
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

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    // For raw response (audio data)
    if (rawResponse) {
      if (!response.ok) {
        const errorText = await response.text();
        throw new PlayHTApiError(errorText || response.statusText, response.status);
      }
      const buffer = await response.arrayBuffer();
      return {
        audio_data: Buffer.from(buffer).toString('base64'),
        content_type: response.headers.get('content-type'),
      } as T;
    }

    // Parse response
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

    // Handle errors
    if (!response.ok) {
      const errorMessage = typeof data === 'object' && data !== null
        ? JSON.stringify(data)
        : String(data || response.statusText);
      throw new PlayHTApiError(errorMessage, response.status);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string | object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown>, params });
  }

  async postRaw<T>(path: string, body?: Record<string, unknown> | object): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown>, rawResponse: true });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }

  getUserId(): string {
    return this.userId;
  }
}
