import type { WaboxappConfig } from '../types';
import { WaboxappApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://www.waboxapp.com/api';

export interface RequestOptions {
  method?: 'GET' | 'POST';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, string | number | boolean | undefined>;
}

export class WaboxappClient {
  private readonly token: string;
  private readonly uid: string;
  private readonly baseUrl: string;

  constructor(config: WaboxappConfig) {
    if (!config.token) {
      throw new Error('WaboxApp API token is required');
    }
    if (!config.uid) {
      throw new Error('WaboxApp sender uid (WhatsApp number) is required');
    }
    this.token = config.token;
    this.uid = config.uid;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  getUid(): string {
    return this.uid;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private toFormData(body: Record<string, string | number | boolean | undefined>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, String(value));
      }
    }
    return params.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body } = options;

    if (method === 'GET') {
      const url = this.buildUrl(path, { token: this.token, ...params });
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      return this.parseResponse<T>(response);
    }

    const formBody = this.toFormData({
      token: this.token,
      uid: this.uid,
      ...body,
    });

    const response = await fetch(this.buildUrl(path), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody,
    });

    return this.parseResponse<T>(response);
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    const text = await response.text();
    let data: unknown = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text };
      }
    }

    if (!response.ok) {
      const errorData = data as { error?: string };
      throw new WaboxappApiError(errorData.error || response.statusText, response.status);
    }

    const payload = data as { success?: boolean; error?: string };
    if (payload.success === false) {
      throw new WaboxappApiError(payload.error || 'Request failed', response.status);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body });
  }
}
