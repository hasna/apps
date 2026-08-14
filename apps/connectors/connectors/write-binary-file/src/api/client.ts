import {
  WriteBinaryFileApiError,
  type JsonRecord,
  type ListQueryOptions,
  type RawRequestOptions,
  type WriteBinaryFileConfig,
} from '../types';

export const DEFAULT_BASE_URL = 'https://api.write-binary-file.com/v1';

export function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function buildQueryString(query?: Record<string, string | number | boolean | undefined>): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.append(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

export class WriteBinaryFileClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: WriteBinaryFileConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  private buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.baseUrl}${normalizedPath}${buildQueryString(query)}`;
  }

  private async request<T>(
    path: string,
    options: RequestInit & { query?: Record<string, string | number | boolean | undefined> } = {},
  ): Promise<T> {
    const { query, headers: extraHeaders, ...fetchOptions } = options;
    const url = this.buildUrl(path, query);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      ...(extraHeaders as Record<string, string> | undefined),
    };

    if (fetchOptions.body !== undefined && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      ...fetchOptions,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let message = errorText;
      try {
        const errorJson = JSON.parse(errorText) as Record<string, unknown>;
        message = String(errorJson.detail ?? errorJson.error ?? errorJson.message ?? errorText);
      } catch {
        // Use raw text
      }
      throw new WriteBinaryFileApiError(message, response.status);
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

  async listFiles(query?: ListQueryOptions): Promise<JsonRecord> {
    return this.request<JsonRecord>('/files', { query });
  }

  async createFile(body: JsonRecord): Promise<JsonRecord> {
    return this.request<JsonRecord>('/files', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async getFile(fileId: string): Promise<JsonRecord> {
    return this.request<JsonRecord>(`/files/${encodePathSegment(fileId)}`);
  }

  async listEvents(query?: ListQueryOptions): Promise<JsonRecord> {
    return this.request<JsonRecord>('/events', { query });
  }

  async search(body: JsonRecord): Promise<JsonRecord> {
    return this.request<JsonRecord>('/search', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async rawRequest(options: RawRequestOptions): Promise<JsonRecord> {
    const method = (options.method || 'GET').toUpperCase();
    const init: RequestInit & { query?: Record<string, string | number | boolean | undefined> } = {
      method,
      query: options.query,
      headers: options.headers,
    };

    if (options.body !== undefined && method !== 'GET' && method !== 'HEAD') {
      init.body = JSON.stringify(options.body);
    }

    return this.request<JsonRecord>(options.path, init);
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
