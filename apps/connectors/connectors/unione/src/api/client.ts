import type { UniOneConfig } from '../types';
import { UniOneApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.unione.io/en/transactional/api/v1';

export interface RequestOptions {
  body?: Record<string, unknown>;
}

export class UniOneClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: UniOneConfig) {
    if (!config.apiKey) {
      throw new Error('UniOne API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  /**
   * Make an authenticated POST request to the UniOne API.
   * All UniOne transactional endpoints use POST with JSON bodies.
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'X-API-KEY': this.apiKey,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(options.body ?? {}),
    });

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
      const errorData = data as { message?: string; code?: string } | undefined;
      throw new UniOneApiError(
        errorData?.message || response.statusText,
        response.status,
        errorData?.code,
      );
    }

    return data as T;
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 12) {
      return `${this.apiKey.substring(0, 8)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
