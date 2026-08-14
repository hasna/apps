import type { JsonRecord, TikTokApiResponse, TikTokEventsConfig } from '../types';
import { TikTokEventsApiError } from '../types';

const DEFAULT_BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3';

export interface RequestOptions {
  method?: string;
  path: string;
  query?: JsonRecord;
  body?: JsonRecord;
}

export class TikTokEventsClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  readonly config: TikTokEventsConfig;

  constructor(config: TikTokEventsConfig) {
    if (!config.accessToken) {
      throw new Error('Access token is required');
    }
    this.accessToken = config.accessToken;
    this.baseUrl = normalizeBaseUrl(config.baseUrl || DEFAULT_BASE_URL);
    this.config = { ...config, baseUrl: this.baseUrl };
  }

  getDefaultAdvertiserId(): string | undefined {
    return this.config.advertiserId;
  }

  buildUrl(path: string, query?: JsonRecord): string {
    const base = new URL(this.baseUrl);
    let url: URL;

    if (/^https?:\/\//i.test(path)) {
      url = new URL(path);
      if (url.origin !== base.origin) {
        throw new Error('TikTok Events API raw requests must target the configured TikTok Business API origin.');
      }
    } else if (path.startsWith('/open_api/')) {
      url = new URL(path, base.origin);
    } else {
      const normalizedPath = path.startsWith('/') ? path : `/${path}`;
      url = new URL(`${this.baseUrl}${normalizedPath}`);
    }

    appendQuery(url, query);
    return url.toString();
  }

  async request<T = unknown>(options: RequestOptions): Promise<TikTokApiResponse<T>> {
    const method = (options.method ?? 'GET').toUpperCase();
    const url = this.buildUrl(options.path, options.query);

    const response = await fetch(url, {
      method,
      headers: {
        'Access-Token': this.accessToken,
        ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
      },
      body: method === 'GET' ? undefined : JSON.stringify(options.body ?? {}),
    });

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new TikTokEventsApiError(
        `TikTok Events API: request failed (${response.status}): invalid JSON`,
        response.status,
      );
    }

    if (!response.ok) {
      throw new TikTokEventsApiError(
        `TikTok Events API: request failed (${response.status}): ${JSON.stringify(data).slice(0, 500)}`,
        response.status,
      );
    }

    if (
      typeof data === 'object' &&
      data !== null &&
      'code' in data &&
      typeof (data as TikTokApiResponse).code === 'number' &&
      (data as TikTokApiResponse).code !== 0
    ) {
      const apiData = data as TikTokApiResponse;
      throw new TikTokEventsApiError(
        `TikTok Events API: API error (${apiData.code}): ${apiData.message ?? 'unknown API error'}`,
        apiData.code,
        apiData.request_id,
      );
    }

    return data as TikTokApiResponse<T>;
  }

  async get<T = unknown>(path: string, query?: JsonRecord): Promise<TikTokApiResponse<T>> {
    return this.request<T>({ method: 'GET', path, query });
  }

  async post<T = unknown>(path: string, body?: JsonRecord, query?: JsonRecord): Promise<TikTokApiResponse<T>> {
    return this.request<T>({ method: 'POST', path, body, query });
  }

  resolveAdvertiserId(options: JsonRecord = {}): string {
    const id = pickString(
      options.advertiserId,
      options.advertiser_id,
      this.config.advertiserId,
    );
    if (!id) {
      throw new Error('TikTok Events API: advertiserId is required for this command.');
    }
    return id;
  }
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function appendQuery(url: URL, query?: JsonRecord): void {
  if (!query) return;

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
}

function pickString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}
