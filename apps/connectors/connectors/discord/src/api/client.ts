import type { DiscordConfig } from '../types';
import { DiscordApiError } from '../types';

const DEFAULT_BASE_URL = 'https://discord.com/api/v10';
const DEFAULT_USER_AGENT = 'DiscordBot (https://github.com/anthropics/connectors, 1.0.0)';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  reason?: string; // X-Audit-Log-Reason header
}

interface DiscordApiResponse {
  code?: number;
  message?: string;
  errors?: Record<string, unknown>;
}

export class DiscordClient {
  private readonly token: string;
  private readonly tokenType: 'Bot' | 'Bearer';
  private readonly baseUrl: string;
  private readonly applicationId?: string;

  constructor(config: DiscordConfig) {
    if (config.botToken) {
      this.token = config.botToken;
      this.tokenType = 'Bot';
    } else if (config.bearerToken) {
      this.token = config.bearerToken;
      this.tokenType = 'Bearer';
    } else {
      throw new Error('Discord token is required (botToken or bearerToken)');
    }
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.applicationId = config.applicationId;
  }

  getApplicationId(): string | undefined {
    return this.applicationId;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  async request<T>(
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const { method = 'GET', params, body, reason } = options;

    const headers: Record<string, string> = {
      'Authorization': `${this.tokenType} ${this.token}`,
      'User-Agent': DEFAULT_USER_AGENT,
    };

    if (reason) {
      headers['X-Audit-Log-Reason'] = encodeURIComponent(reason);
    }

    const url = this.buildUrl(path, method === 'GET' ? params : undefined);

    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (body && method !== 'GET') {
      if (body instanceof FormData) {
        fetchOptions.body = body;
      } else {
        headers['Content-Type'] = 'application/json';
        fetchOptions.body = JSON.stringify(body as Record<string, unknown>);
      }
    }

    const response = await fetch(url, fetchOptions);

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    const data = await response.json() as T & DiscordApiResponse;

    if (!response.ok) {
      throw new DiscordApiError(
        data.message || `HTTP ${response.status}: ${response.statusText}`,
        data.code || response.status,
        response.status,
        data.errors
      );
    }

    return data;
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined> | object
  ): Promise<T> {
    return this.request<T>(path, { method: 'GET', params: params as Record<string, string | number | boolean | undefined> });
  }

  async post<T>(
    path: string,
    body?: unknown,
    reason?: string
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, reason });
  }

  async put<T>(
    path: string,
    body?: unknown,
    reason?: string
  ): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, reason });
  }

  async patch<T>(
    path: string,
    body?: unknown,
    reason?: string
  ): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body, reason });
  }

  async delete<T>(
    path: string,
    reason?: string
  ): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', reason });
  }
}
