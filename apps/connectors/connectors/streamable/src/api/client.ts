import { StreamableApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.streamable.com';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Streamable: ${label} is required`);
  }
  return value.trim();
}

export function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

export class StreamableClient {
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = DEFAULT_BASE_URL;
  }

  async request<T>(
    path: string,
    options: {
      method?: string;
      body?: Record<string, unknown>;
      params?: Record<string, string | number | boolean | undefined>;
    } = {},
  ): Promise<T> {
    const { method = 'GET', body, params } = options;
    const query = params ? buildQuery(params) : '';
    const url = `${this.baseUrl}${path}${query}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    const fetchOptions: RequestInit = { method, headers };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (response.status === 204) return {} as T;

    const text = await response.text();
    let data: unknown = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    if (!response.ok) {
      const record = asRecord(data);
      const message =
        (typeof record.message === 'string' && record.message) ||
        (typeof record.error === 'string' && record.error) ||
        response.statusText ||
        'Request failed';
      throw new StreamableApiError(message, response.status);
    }

    return data as T;
  }
}
