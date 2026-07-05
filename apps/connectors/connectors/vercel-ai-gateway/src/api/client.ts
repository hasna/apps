import type {
  GatewayCompatibility,
  GatewayMethod,
  VercelAiGatewayConfig,
} from '../types';
import { VercelAiGatewayApiError } from '../types';

export const OPENAI_BASE_URL = 'https://ai-gateway.vercel.sh/v1';
export const ANTHROPIC_BASE_URL = 'https://ai-gateway.vercel.sh';
export const OPENRESPONSES_BASE_URL = 'https://ai-gateway.vercel.sh/openresponses/v1';

export interface RequestOptions {
  method?: GatewayMethod;
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  baseUrl?: string;
}

export function resolveBaseUrl(compatibility: GatewayCompatibility = 'openai'): string {
  switch (compatibility) {
    case 'anthropic':
      return ANTHROPIC_BASE_URL;
    case 'openresponses':
      return OPENRESPONSES_BASE_URL;
    default:
      return OPENAI_BASE_URL;
  }
}

export class VercelAiGatewayClient {
  private readonly apiKey: string;
  private readonly defaultBaseUrl: string;

  constructor(config: VercelAiGatewayConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.defaultBaseUrl = config.baseUrl || OPENAI_BASE_URL;
  }

  private buildUrl(
    path: string,
    baseUrl: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${baseUrl}${normalizedPath}`);
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
    const { method = 'GET', params, body, headers = {}, baseUrl } = options;
    const resolvedBaseUrl = baseUrl || this.defaultBaseUrl;
    const url = this.buildUrl(path, resolvedBaseUrl, params);

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
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
      let errorMessage = String(data || response.statusText);
      if (typeof data === 'object' && data !== null) {
        const errorObj = data as { error?: { message?: string }; message?: string };
        errorMessage = errorObj.error?.message || errorObj.message || JSON.stringify(data);
      }
      throw new VercelAiGatewayApiError(errorMessage, response.status);
    }

    return data as T;
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    baseUrl?: string,
  ): Promise<T> {
    return this.request<T>(path, { method: 'GET', params, baseUrl });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | string,
    options: Omit<RequestOptions, 'method' | 'body'> = {},
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  getApiKey(): string {
    return this.apiKey;
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
