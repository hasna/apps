import type { TrueLayerConfig } from '../types';
import { TrueLayerApiError } from '../types';

const PRODUCTION_BASE_URL = 'https://api.truelayer.com/v1';
const SANDBOX_BASE_URL = 'https://api.truelayer-sandbox.com/v1';

export interface TrueLayerRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * TrueLayer API HTTP client with Bearer token authentication.
 */
export class TrueLayerClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;

  constructor(config: TrueLayerConfig) {
    if (!config.accessToken) {
      throw new Error('TrueLayer access token is required');
    }
    this.accessToken = config.accessToken;
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl.replace(/\/$/, '');
    } else {
      this.baseUrl = config.sandbox ? SANDBOX_BASE_URL : PRODUCTION_BASE_URL;
    }
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  isSandbox(): boolean {
    return this.baseUrl === SANDBOX_BASE_URL;
  }

  async request<T>(path: string, options: TrueLayerRequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
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

    if (response.status === 204) {
      return {} as T;
    }

    const contentType = response.headers.get('content-type') || '';
    let data: unknown;

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
      const traceId = response.headers.get('tl-trace-id') || response.headers.get('Tl-Trace-Id') || undefined;
      let errorMessage = `TrueLayer API Error: ${response.status} ${response.statusText}`;
      let errorCode: string | undefined;

      if (typeof data === 'object' && data !== null) {
        const errData = data as Record<string, unknown>;
        errorCode = (errData.error || errData.type || errData.code) as string | undefined;
        const detail = errData.detail || errData.message || errData.title;
        if (detail) {
          errorMessage = String(detail);
        }
      }

      throw new TrueLayerApiError(errorMessage, response.status, errorCode, traceId);
    }

    return data as T;
  }

  getTokenPreview(): string {
    if (this.accessToken.length > 12) {
      return `${this.accessToken.substring(0, 6)}...${this.accessToken.substring(this.accessToken.length - 4)}`;
    }
    return '***';
  }
}

export { PRODUCTION_BASE_URL, SANDBOX_BASE_URL };
