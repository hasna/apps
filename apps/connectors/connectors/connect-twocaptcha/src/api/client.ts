import type { ConnectorConfig } from '../types';
import { assertApiSuccess, ConnectorApiError, parseApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.2captcha.com';

export interface PostOptions {
  retries?: number;
  timeout?: number;
}

export class ConnectorClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: ConnectorConfig) {
    const key = config.apiKey || config.token;
    if (!key) {
      throw new Error('2Captcha API key is required');
    }
    this.apiKey = key;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
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

  /**
   * POST JSON to a 2Captcha endpoint with clientKey injected into the body.
   */
  async post<T extends { errorId: number }>(
    path: string,
    body: Record<string, unknown> = {},
    options: PostOptions = {}
  ): Promise<T> {
    const { retries = 3, timeout = 30000 } = options;
    const url = `${this.baseUrl}${path}`;
    const payload = { clientKey: this.apiKey, ...body };

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    let lastError: Error | null = null;
    let lastStatus = 0;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        lastStatus = response.status;

        const text = await response.text();
        let data: unknown;
        if (text) {
          try {
            data = JSON.parse(text);
          } catch {
            data = text;
          }
        }

        if (!response.ok) {
          if (this.isRetryableStatus(response.status) && attempt < retries) {
            const retryAfter = response.headers.get('retry-after');
            const delay = retryAfter
              ? parseInt(retryAfter, 10) * 1000
              : this.getRetryDelay(attempt);
            await this.sleep(delay);
            continue;
          }
          throw parseApiError(data, response.status);
        }

        const parsed = data as T;
        return assertApiSuccess(parsed, response.status);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (lastError.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${timeout}ms`);
        }

        if (attempt < retries && !(err instanceof ConnectorApiError)) {
          await this.sleep(this.getRetryDelay(attempt));
          continue;
        }

        throw err;
      }
    }

    throw lastError || new ConnectorApiError('Request failed', lastStatus);
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
