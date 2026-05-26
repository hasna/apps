import type { AmplitudeConfig, OutputFormat, AmplitudeErrorResponse } from '../types';
import { AmplitudeApiError } from '../types';

// Amplitude API endpoints
const API_BASE_URL = 'https://amplitude.com/api/2';
const BATCH_API_URL = 'https://api2.amplitude.com/2';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  format?: OutputFormat;
  useBatchApi?: boolean;
}

export class AmplitudeClient {
  private readonly apiKey: string;
  private readonly secretKey: string;

  constructor(config: AmplitudeConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    if (!config.secretKey) {
      throw new Error('Secret key is required');
    }
    this.apiKey = config.apiKey;
    this.secretKey = config.secretKey;
  }

  private getBaseUrl(useBatchApi?: boolean): string {
    return useBatchApi ? BATCH_API_URL : API_BASE_URL;
  }

  private getAuthHeader(): string {
    const credentials = `${this.apiKey}:${this.secretKey}`;
    const encoded = Buffer.from(credentials).toString('base64');
    return `Basic ${encoded}`;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>, useBatchApi?: boolean): string {
    const url = new URL(`${this.getBaseUrl(useBatchApi)}${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  /**
   * Make an authenticated request to Amplitude API
   * Uses Basic Auth with API Key and Secret Key
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, useBatchApi } = options;

    const url = this.buildUrl(path, params, useBatchApi);

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

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
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
      let errorMessage: string;
      let errorCode: number | undefined;

      if (typeof data === 'object' && data !== null) {
        const errorData = data as AmplitudeErrorResponse;
        errorMessage = errorData.error || errorData.message || JSON.stringify(data);
        errorCode = errorData.code;
      } else {
        errorMessage = String(data || response.statusText);
      }

      throw new AmplitudeApiError(errorMessage, response.status, errorCode);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string | object, params?: Record<string, string | number | boolean | undefined>, useBatchApi?: boolean): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown>, params, useBatchApi });
  }

  /**
   * Get a preview of the API key (for display/debugging)
   */
  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
