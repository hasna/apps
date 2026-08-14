import type { StandardSignalConfig } from '../types';
import { DEFAULT_BASE_URL, StandardSignalApiError } from '../types';

export interface StandardSignalRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Standard Signal API Client
 */
export class StandardSignalClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: StandardSignalConfig) {
    if (!config.apiKey) {
      throw new Error('Standard Signal API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async request<T>(path: string, options: StandardSignalRequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      ...headers,
    };

    if (body !== undefined) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const response = await fetch(url.toString(), {
      method,
      headers: requestHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const contentType = response.headers.get('content-type') || '';
    let data: unknown;

    if (response.status === 204) {
      return {} as T;
    }

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
      const requestId = response.headers.get('x-request-id') || undefined;
      let errorMessage = `Standard Signal API Error: ${response.status} ${response.statusText}`;
      let errorCode: string | undefined;

      if (typeof data === 'object' && data !== null) {
        const errData = data as Record<string, unknown>;
        errorCode = errData.code as string | undefined;
        errorMessage = (errData.message || errData.error || errorMessage) as string;
      }

      throw new StandardSignalApiError(errorMessage, response.status, errorCode, requestId);
    }

    return data as T;
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 12) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
