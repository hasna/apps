import type { ZohoBiginConfig } from '../types';
import { ZohoBiginApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://www.zohoapis.com/bigin/v2';

const MAX_RETRIES = 3;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RequestOptions {
  method?: string;
  body?: Record<string, unknown> | unknown[];
  params?: Record<string, string | number | boolean | undefined>;
}

export class ZohoBiginClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(config: ZohoBiginConfig) {
    if (!config.token) {
      throw new Error('Zoho Bigin token is required');
    }
    this.token = config.token;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const normalizedMethod = method.toUpperCase();
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Zoho-oauthtoken ${this.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    const fetchOptions: RequestInit = { method: normalizedMethod, headers };
    if (body !== undefined && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(normalizedMethod)) {
      fetchOptions.body = JSON.stringify(body);
    }

    let lastError: ZohoBiginApiError | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const response = await fetch(url.toString(), fetchOptions);

      if (response.status === 204) {
        return {} as T;
      }

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        return data as T;
      }

      const err = data as { message?: string; code?: string };
      lastError = new ZohoBiginApiError(
        err.message || response.statusText || 'Request failed',
        response.status,
        err.code,
      );

      if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
        const delay = Math.min(1000 * 2 ** attempt, 8000);
        await sleep(delay);
        continue;
      }

      throw lastError;
    }

    throw lastError ?? new ZohoBiginApiError('Request failed', 500);
  }
}
