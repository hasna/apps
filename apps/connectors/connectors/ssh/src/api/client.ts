import type { HttpMethod, SshConfig } from '../types';
import { SshApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.ssh.com/v1';

export interface RequestOptions {
  method?: HttpMethod;
  body?: Record<string, unknown> | unknown[];
  params?: Record<string, string | number | boolean | undefined>;
  retries?: number;
  timeout?: number;
}

export class SshClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: SshConfig) {
    if (!config.apiKey) throw new Error('SSH API key is required');
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getRetryDelay(attempt: number): number {
    return 1000 * Math.pow(2, attempt) + Math.random() * 1000;
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || (status >= 500 && status < 600);
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, params, retries = 3, timeout = 30000 } = options;
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
    };

    const fetchOptions: RequestInit = { method, headers };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(body);
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url.toString(), {
          ...fetchOptions,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.status === 204) return {} as T;

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          if (this.isRetryableStatus(response.status) && attempt < retries) {
            const retryAfter = response.headers.get('retry-after');
            const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : this.getRetryDelay(attempt);
            await this.sleep(delay);
            continue;
          }

          throw new SshApiError(
            (data as { message?: string })?.message || response.statusText,
            response.status,
          );
        }

        return data as T;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (lastError.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${timeout}ms`);
        }

        if (attempt < retries && !(err instanceof SshApiError)) {
          await this.sleep(this.getRetryDelay(attempt));
          continue;
        }

        throw err;
      }
    }

    throw lastError || new SshApiError('Request failed', 0);
  }
}
