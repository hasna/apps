import type { Smtp2goConfig, Smtp2goResponse } from '../types';
import { Smtp2goApiError, parseApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.smtp2go.com/v3';

export interface RequestOptions {
  /** Number of retries for rate-limit / server errors (default: 3). */
  retries?: number;
  /** Timeout in milliseconds (default: 30000). */
  timeout?: number;
  headers?: Record<string, string>;
}

/**
 * HTTP transport for the SMTP2GO v3 API.
 *
 * Every v3 endpoint is a POST that takes a JSON body and returns a
 * `{ request_id, data }` envelope. Authentication is via the
 * `X-Smtp2go-Api-Key` header; the api key is also included in the body as
 * `api_key` for compatibility with clients that only send a body.
 */
export class Smtp2goClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: Smtp2goConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getRetryDelay(attempt: number, baseDelay = 1000): number {
    // Exponential backoff with jitter.
    return baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || (status >= 500 && status < 600);
  }

  /**
   * Make an authenticated POST request and return the unwrapped `data`
   * payload from the SMTP2GO response envelope.
   */
  async post<T>(path: string, body: Record<string, unknown> = {}, options: RequestOptions = {}): Promise<T> {
    const { retries = 3, timeout = 30000, headers = {} } = options;
    const url = `${this.baseUrl}${path}`;

    const requestHeaders: Record<string, string> = {
      'X-Smtp2go-Api-Key': this.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...headers,
    };

    // The api key is also accepted in the body; include it so requests work
    // even when a proxy strips custom headers.
    const payload = JSON.stringify({ api_key: this.apiKey, ...body });

    let lastError: Error | null = null;
    let lastStatus = 0;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        let response: Response;
        try {
          response = await fetch(url, {
            method: 'POST',
            headers: requestHeaders,
            body: payload,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }

        lastStatus = response.status;

        let data: unknown;
        const text = await response.text();
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
            const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : this.getRetryDelay(attempt);
            await this.sleep(delay);
            continue;
          }
          throw parseApiError(data, response.status);
        }

        // Unwrap the { request_id, data } envelope when present.
        if (data && typeof data === 'object' && 'data' in (data as Record<string, unknown>)) {
          return (data as Smtp2goResponse<T>).data;
        }
        return data as T;
      } catch (err) {
        if (err instanceof Smtp2goApiError) {
          throw err;
        }

        lastError = err instanceof Error ? err : new Error(String(err));
        if (lastError.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${timeout}ms`);
        }

        if (attempt < retries) {
          await this.sleep(this.getRetryDelay(attempt));
          continue;
        }
        throw lastError;
      }
    }

    throw lastError || new Smtp2goApiError('Request failed', lastStatus);
  }

  /** Return a masked preview of the API key for display. */
  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
