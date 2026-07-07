import type { StageConfig, StageErrorBody } from '../types';
import { StageApiError } from '../types';

export const STAGE_API_BASE = 'https://api.stage.dev/v1';

export interface StageRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
}

/**
 * Stage API Client
 *
 * Thin fetch wrapper that handles bearer authentication, base URL resolution,
 * query serialization and error normalization for the Stage REST API.
 */
export class StageClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: StageConfig) {
    if (!config.apiKey) {
      throw new Error('Stage API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || STAGE_API_BASE).replace(/\/+$/, '');
  }

  /**
   * Make a request to the Stage API.
   *
   * @param path API path beginning with `/` (e.g. `/reviews`)
   */
  async request<T>(path: string, options: StageRequestOptions = {}): Promise<T> {
    const { method = 'GET', query, body } = options;

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    let url = `${this.baseUrl}${normalizedPath}`;

    if (query) {
      const searchParams = new URLSearchParams();
      Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      });
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
    };

    let fetchBody: string | undefined;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      fetchBody = JSON.stringify(body);
    }

    const response = await fetch(url, {
      method,
      headers,
      body: fetchBody,
    });

    const text = await response.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const errorBody = (typeof data === 'object' && data !== null ? data : {}) as StageErrorBody;
      const nestedError =
        typeof errorBody.error === 'object' && errorBody.error !== null
          ? errorBody.error.message
          : typeof errorBody.error === 'string'
            ? errorBody.error
            : undefined;
      const message =
        errorBody.message ||
        nestedError ||
        (typeof data === 'string' && data ? data : `Stage API error (HTTP ${response.status})`);
      throw new StageApiError(message, response.status, errorBody.code);
    }

    return data as T;
  }

  /**
   * Get a masked preview of the API key (for display/debugging).
   */
  getKeyPreview(): string {
    if (this.apiKey.length <= 8) {
      return '***';
    }
    return `${this.apiKey.slice(0, 4)}...${this.apiKey.slice(-4)}`;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
