import type { DeepLConfig } from '../types';
import { DeepLApiError } from '../types';

// DeepL API base URLs
const PRO_BASE_URL = 'https://api.deepl.com/v2';
const FREE_BASE_URL = 'https://api-free.deepl.com/v2';

export interface RequestOptions {
  method?: 'GET' | 'POST';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | FormData;
  isForm?: boolean;
}

export class DeepLClient {
  private readonly authKey: string;
  private readonly baseUrl: string;

  constructor(config: DeepLConfig) {
    if (!config.authKey) throw new Error('DeepL auth key is required');
    this.authKey = config.authKey;
    // Free keys end with ':fx'
    this.baseUrl = config.baseUrl || (config.authKey.endsWith(':fx') ? FREE_BASE_URL : PRO_BASE_URL);
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, isForm = false } = options;

    const url = new URL(`${this.baseUrl}${path}`);
    if (params && method === 'GET') {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) url.searchParams.append(k, String(v));
      });
    }

    const headers: Record<string, string> = {
      Authorization: `DeepL-Auth-Key ${this.authKey}`,
    };

    const fetchOptions: RequestInit = { method, headers };

    if (body && method === 'POST') {
      if (isForm || body instanceof FormData) {
        fetchOptions.body = body as FormData;
      } else {
        headers['Content-Type'] = 'application/json';
        fetchOptions.body = JSON.stringify(body);
      }
    }

    const response = await fetch(url.toString(), fetchOptions);

    if (response.status === 204) return {} as T;

    let data: unknown;
    const ct = response.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const msg = (data as { message?: string })?.message || response.statusText;
      throw new DeepLApiError(msg, response.status);
    }

    return data as T;
  }

  getAuthKeyPreview(): string {
    return `${this.authKey.substring(0, 8)}...`;
  }
}
