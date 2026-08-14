import type { UpstashConfig } from '../types';
import { UpstashApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.upstash.com/v2';
const DEFAULT_TIMEOUT_MS = 15_000;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: Record<string, unknown>;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value && typeof value === 'object') {
    return redactSensitive(value as Record<string, unknown>);
  }
  return value;
}

export function redactSensitive<T extends Record<string, unknown>>(data: T): T {
  const result = { ...data } as Record<string, unknown>;
  for (const key of Object.keys(result)) {
    if (key === 'password' || key.endsWith('_password')) {
      result[key] = '[redacted]';
    } else if (result[key] && typeof result[key] === 'object') {
      result[key] = redactValue(result[key]);
    }
  }
  return result as T;
}

export class UpstashClient {
  private readonly email: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: UpstashConfig) {
    if (!config.email) {
      throw new Error('Email is required');
    }
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.email = config.email;
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  private getAuthHeader(): string {
    const credentials = `${this.email}:${this.apiKey}`;
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body } = options;
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      Authorization: this.getAuthHeader(),
      Accept: 'application/json',
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

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
      const record = data && typeof data === 'object' ? data as Record<string, unknown> : {};
      const message = String(record.error ?? record.message ?? response.statusText);
      throw new UpstashApiError(message, response.status);
    }

    return redactValue(data) as T;
  }

  getEmailPreview(): string {
    const [local, domain] = this.email.split('@');
    if (local && domain) {
      return `${local.substring(0, 3)}...@${domain}`;
    }
    return '***@***';
  }
}
