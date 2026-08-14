import {
  WindmillApiError,
  type WindmillConfig,
  type ScriptRecord,
  type SearchRequest,
  type RawRequestOptions,
} from '../types';

export const DEFAULT_BASE_URL = 'https://api.windmill.dev/v1';

export class WindmillClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly workspace?: string;

  constructor(config: WindmillConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.workspace = config.workspace;
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

    if (this.workspace) {
      headers['X-Workspace'] = this.workspace;
    }

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
      throw new WindmillApiError(message, response.status);
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

  async listScripts(query?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request('/scripts', { query });
  }

  async createScript(body: ScriptRecord): Promise<unknown> {
    return this.request('/scripts', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async getScript(scriptId: string): Promise<unknown> {
    const encodedId = encodeURIComponent(scriptId);
    return this.request(`/scripts/${encodedId}`);
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
