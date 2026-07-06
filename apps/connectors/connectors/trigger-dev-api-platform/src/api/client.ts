import type { TriggerDevConfig } from '../types';
import { TriggerDevApiError } from '../types';
import { isPersonalAccessToken } from '../utils/config';

const DEFAULT_BASE_URL = 'https://api.trigger.dev';
const MAX_RETRIES = 3;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

export class TriggerDevClient {
  private readonly apiKey: string;
  private readonly projectRef?: string;
  private readonly baseUrl: string;

  constructor(config: TriggerDevConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.projectRef = config.projectRef;
    this.baseUrl = DEFAULT_BASE_URL;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }

    return url.toString();
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;
    const url = this.buildUrl(path, params);

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

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
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

      if (response.ok) {
        return data as T;
      }

      const errorData = data as { error?: string; details?: Array<{ message?: string }> } | undefined;
      const detailMessage = errorData?.details?.[0]?.message;
      const message = detailMessage || errorData?.error || response.statusText;
      const apiError = new TriggerDevApiError(message, response.status);

      if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
        const retryAfter = response.headers.get('retry-after');
        const delayMs = retryAfter
          ? Math.min(Number(retryAfter) * 1000, 30_000)
          : Math.min(1000 * 2 ** attempt, 10_000);
        lastError = apiError;
        await this.sleep(delayMs);
        continue;
      }

      throw apiError;
    }

    throw lastError ?? new TriggerDevApiError('Request failed after retries', 500);
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | string | object,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown>, params });
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }

  isPersonalAccessToken(): boolean {
    return isPersonalAccessToken(this.apiKey);
  }

  getProjectRef(): string | undefined {
    return this.projectRef;
  }
}

export function flattenRunsListParams(params?: {
  pageSize?: number;
  pageAfter?: string;
  pageBefore?: string;
  status?: string[];
  taskIdentifier?: string[];
  period?: string;
  isTest?: boolean;
}): Record<string, string | number | boolean | undefined> {
  const query: Record<string, string | number | boolean | undefined> = {};

  if (params?.pageSize !== undefined) {
    query['page[size]'] = params.pageSize;
  }
  if (params?.pageAfter) {
    query['page[after]'] = params.pageAfter;
  }
  if (params?.pageBefore) {
    query['page[before]'] = params.pageBefore;
  }
  if (params?.status?.length) {
    query['filter[status]'] = params.status.join(',');
  }
  if (params?.taskIdentifier?.length) {
    query['filter[taskIdentifier]'] = params.taskIdentifier.join(',');
  }
  if (params?.period) {
    query['filter[createdAt][period]'] = params.period;
  }
  if (params?.isTest !== undefined) {
    query['filter[isTest]'] = params.isTest;
  }

  return query;
}
