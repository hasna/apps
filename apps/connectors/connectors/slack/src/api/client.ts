import type { SlackConfig, SlackApiResponse, OutputFormat } from '../types';
import { SlackApiError } from '../types';

const DEFAULT_BASE_URL = 'https://slack.com/api';

export interface RequestOptions {
  method?: 'GET' | 'POST';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
  format?: OutputFormat;
}

export class SlackClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(config: SlackConfig) {
    const token = config.accessToken || config.botToken;
    if (!token) {
      throw new Error('Slack token is required (accessToken or botToken)');
    }
    this.token = token;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}/${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  async request<T extends SlackApiResponse>(
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const { method = 'GET', params, body } = options;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json; charset=utf-8',
    };

    const url = this.buildUrl(path, method === 'GET' ? params : undefined);

    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (body && method === 'POST') {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      throw new SlackApiError(
        `HTTP ${response.status}: ${response.statusText}`,
        'http_error',
        response.status
      );
    }

    const data = await response.json() as T;

    if (!data.ok) {
      throw new SlackApiError(
        data.error || 'Unknown Slack API error',
        data.error || 'unknown_error'
      );
    }

    return data;
  }

  async get<T extends SlackApiResponse>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T extends SlackApiResponse>(
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body });
  }
}
