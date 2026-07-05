import type { ConnectorConfig, OutputFormat } from '../types';
import { ZeroBounceApiError, parseApiError } from '../types';

export const API_BASE_URL = 'https://api.zerobounce.net';
export const BULK_API_BASE_URL = 'https://bulkapi.zerobounce.net';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string | FormData;
  headers?: Record<string, string>;
  format?: OutputFormat;
  baseUrl?: string;
  /** Include api_key in JSON body (for POST JSON endpoints) */
  apiKeyInBody?: boolean;
  retries?: number;
  timeout?: number;
}

export class ConnectorClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly bulkBaseUrl: string;

  constructor(config: ConnectorConfig) {
    const key = config.apiKey || config.token || config.accessToken;
    if (!key) {
      throw new Error('ZeroBounce API key is required');
    }
    this.apiKey = key;
    this.baseUrl = config.baseUrl || API_BASE_URL;
    this.bulkBaseUrl = config.bulkBaseUrl || BULK_API_BASE_URL;
  }

  private buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    baseUrl?: string,
    includeApiKey = true
  ): string {
    const url = new URL(`${baseUrl || this.baseUrl}${path}`);

    if (includeApiKey) {
      url.searchParams.append('api_key', this.apiKey);
    }

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getRetryDelay(attempt: number, baseDelay = 1000): number {
    return baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || (status >= 500 && status < 600);
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const {
      method = 'GET',
      params,
      body,
      headers = {},
      baseUrl,
      apiKeyInBody = false,
      retries = 3,
      timeout = 30000,
    } = options;

    const resolvedBase = baseUrl || this.baseUrl;
    const includeApiKeyInQuery = method === 'GET' || !apiKeyInBody;
    const url = this.buildUrl(path, params, resolvedBase, includeApiKeyInQuery);

    const requestHeaders: Record<string, string> = {
      Accept: 'application/json',
      ...headers,
    };

    let requestBody: BodyInit | undefined;

    if (body !== undefined && ['POST', 'PUT', 'PATCH'].includes(method)) {
      if (body instanceof FormData) {
        if (!body.has('api_key')) {
          body.append('api_key', this.apiKey);
        }
        requestBody = body;
      } else if (typeof body === 'string') {
        requestBody = body;
        requestHeaders['Content-Type'] = 'application/json';
      } else {
        const payload = apiKeyInBody
          ? { ...(body as Record<string, unknown>), api_key: this.apiKey }
          : body;
        requestHeaders['Content-Type'] = 'application/json';
        requestBody = JSON.stringify(payload);
      }
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
      body: requestBody,
    };

    const maxRetries = method === 'GET' ? retries : 0;
    let lastError: Error | null = null;
    let lastStatus = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        let response: Response;
        try {
          response = await fetch(url, {
            ...fetchOptions,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }
        lastStatus = response.status;

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
          if (this.isRetryableStatus(response.status) && attempt < maxRetries) {
            const retryAfter = response.headers.get('retry-after');
            const delay = retryAfter
              ? parseInt(retryAfter, 10) * 1000
              : this.getRetryDelay(attempt);

            await this.sleep(delay);
            continue;
          }

          throw parseApiError(data, response.status);
        }

        return data as T;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (lastError.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${timeout}ms`);
        }

        if (attempt < maxRetries && !(err instanceof ZeroBounceApiError)) {
          await this.sleep(this.getRetryDelay(attempt));
          continue;
        }

        throw lastError;
      }
    }

    throw lastError || new ZeroBounceApiError('Request failed', lastStatus);
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    baseUrl?: string
  ): Promise<T> {
    return this.request<T>(path, { method: 'GET', params, baseUrl });
  }

  async postJson<T>(
    path: string,
    body?: Record<string, unknown>,
    options?: {
      baseUrl?: string;
      apiKeyInBody?: boolean;
      params?: Record<string, string | number | boolean | undefined>;
      retries?: number;
      timeout?: number;
    }
  ): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body,
      baseUrl: options?.baseUrl,
      apiKeyInBody: options?.apiKeyInBody ?? true,
      params: options?.params,
      retries: options?.retries,
      timeout: options?.timeout,
    });
  }

  async postForm<T>(path: string, formData: FormData, baseUrl?: string): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: formData,
      baseUrl: baseUrl || this.bulkBaseUrl,
    });
  }

  async getBulk<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.get<T>(path, params, this.bulkBaseUrl);
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }

  getBulkBaseUrl(): string {
    return this.bulkBaseUrl;
  }
}
