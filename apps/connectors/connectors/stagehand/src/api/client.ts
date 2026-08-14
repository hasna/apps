import { StagehandApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.stagehand.browserbase.com';

export interface StagehandClientConfig {
  browserbaseApiKey: string;
  modelApiKey: string;
  browserbaseProjectId?: string;
  baseUrl?: string;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

function isProtectedAuthHeader(name: string): boolean {
  const normalized = name.toLowerCase();
  return (
    normalized === 'authorization' ||
    normalized === 'x-bb-api-key' ||
    normalized === 'x-bb-project-id' ||
    normalized === 'x-model-api-key'
  );
}

export class StagehandClient {
  private readonly browserbaseApiKey: string;
  private readonly modelApiKey: string;
  private readonly browserbaseProjectId?: string;
  private readonly baseUrl: string;

  constructor(config: StagehandClientConfig) {
    if (!config.browserbaseApiKey) {
      throw new Error('Browserbase API key is required');
    }
    if (!config.modelApiKey) {
      throw new Error('Model API key is required');
    }

    this.browserbaseApiKey = config.browserbaseApiKey;
    this.modelApiKey = config.modelApiKey;
    this.browserbaseProjectId = config.browserbaseProjectId;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }

    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;
    const url = this.buildUrl(path, params);
    const customHeaders = Object.fromEntries(
      Object.entries(headers).filter(([name]) => !isProtectedAuthHeader(name))
    );

    const requestHeaders: Record<string, string> = {
      ...customHeaders,
      'x-bb-api-key': this.browserbaseApiKey,
      'x-model-api-key': this.modelApiKey,
      Accept: 'application/json',
    };

    if (this.browserbaseProjectId) {
      requestHeaders['x-bb-project-id'] = this.browserbaseProjectId;
    }

    const hasBody = body !== undefined && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    if (hasBody) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (hasBody) {
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
      data = text ? JSON.parse(text) : {};
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      let errorMessage = `Stagehand API Error: ${response.status} ${response.statusText}`;

      if (typeof data === 'object' && data !== null) {
        const errData = data as Record<string, unknown>;
        errorMessage = String(errData.message || errData.error || errData.detail || errorMessage);
      } else if (typeof data === 'string' && data) {
        errorMessage = data;
      }

      throw new StagehandApiError(errorMessage, response.status, data);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: unknown,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  getBrowserbaseApiKeyPreview(): string {
    if (this.browserbaseApiKey.length > 12) {
      return `${this.browserbaseApiKey.substring(0, 6)}...${this.browserbaseApiKey.substring(
        this.browserbaseApiKey.length - 4
      )}`;
    }
    return '***';
  }

  getModelApiKeyPreview(): string {
    if (this.modelApiKey.length > 12) {
      return `${this.modelApiKey.substring(0, 6)}...${this.modelApiKey.substring(this.modelApiKey.length - 4)}`;
    }
    return '***';
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
