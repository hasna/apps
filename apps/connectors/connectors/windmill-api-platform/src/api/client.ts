import {
  WindmillApiPlatformApiError,
  type WindmillApiPlatformConfig,
  type ItemRecord,
  type EventRecord,
  type SearchRequest,
  type RawRequestOptions,
} from '../types';

export const DEFAULT_BASE_URL = 'https://api.windmillapiplatform.com/v1';

export class WindmillApiPlatformClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: WindmillApiPlatformConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async request<T>(
    path: string,
    options: RequestInit & { query?: Record<string, string | number | boolean | undefined> } = {}
  ): Promise<T> {
    const { query, ...fetchOptions } = options;
    const url = this.buildUrl(path, query);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      ...(fetchOptions.headers as Record<string, string> | undefined),
    };

    const method = (fetchOptions.method || 'GET').toUpperCase();
    if (fetchOptions.body !== undefined && method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    const response = await fetch(url, {
      ...fetchOptions,
      method,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let message = errorText;
      try {
        const errorJson = JSON.parse(errorText) as { error?: string; message?: string; detail?: string };
        message = errorJson.detail || errorJson.error || errorJson.message || errorText;
      } catch {
        // Use raw text
      }
      throw new WindmillApiPlatformApiError(message, response.status);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (!text) {
      return undefined as T;
    }

    return JSON.parse(text) as T;
  }

  async listItems(query?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request('/items', { query });
  }

  async createItem(body: ItemRecord): Promise<unknown> {
    return this.request('/items', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async getItem(itemId: string): Promise<unknown> {
    const encodedId = encodeURIComponent(itemId);
    return this.request(`/items/${encodedId}`);
  }

  async listEvents(query?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request('/events', { query });
  }

  async search(body: SearchRequest): Promise<unknown> {
    return this.request('/search', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async rawRequest(options: RawRequestOptions): Promise<unknown> {
    const method = (options.method || 'GET').toUpperCase();
    const path = options.path.startsWith('/') ? options.path : `/${options.path}`;
    const init: RequestInit & { query?: Record<string, string | number | boolean | undefined> } = {
      method,
      query: options.query,
      headers: options.headers,
    };

    if (options.body !== undefined && method !== 'GET' && method !== 'HEAD') {
      init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }

    return this.request(path, init);
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
