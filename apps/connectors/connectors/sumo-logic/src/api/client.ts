import type { SumoLogicConfig, SumoLogicErrorResponse } from '../types';
import { SumoLogicApiError } from '../types';

// Deployment (region) -> API endpoint base.
// https://help.sumologic.com/docs/api/getting-started/#which-endpoint-should-i-should-use
const DEPLOYMENTS: Record<string, string> = {
  us1: 'https://api.sumologic.com',
  us2: 'https://api.us2.sumologic.com',
  eu: 'https://api.eu.sumologic.com',
  au: 'https://api.au.sumologic.com',
  ca: 'https://api.ca.sumologic.com',
  de: 'https://api.de.sumologic.com',
  jp: 'https://api.jp.sumologic.com',
  in: 'https://api.in.sumologic.com',
  fed: 'https://api.fed.sumologic.com',
};

const DEFAULT_DEPLOYMENT = 'us1';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

/**
 * Resolve a deployment name or endpoint override to an API endpoint base URL
 * (without the trailing `/api`).
 */
export function resolveEndpoint(deployment?: string, endpoint?: string): string {
  if (endpoint) {
    return endpoint.replace(/\/+$/, '').replace(/\/api$/, '');
  }
  const key = (deployment || DEFAULT_DEPLOYMENT).toLowerCase();
  return DEPLOYMENTS[key] || DEPLOYMENTS[DEFAULT_DEPLOYMENT]!;
}

export class SumoLogicClient {
  private readonly accessId: string;
  private readonly accessKey: string;
  private readonly baseUrl: string;
  private readonly authHeader: string;
  // Simple cookie jar for Search Job API session affinity.
  private cookies: Map<string, string> = new Map();

  constructor(config: SumoLogicConfig) {
    if (!config.accessId) {
      throw new Error('Access ID is required');
    }
    if (!config.accessKey) {
      throw new Error('Access key is required');
    }
    this.accessId = config.accessId;
    this.accessKey = config.accessKey;
    this.baseUrl = `${resolveEndpoint(config.deployment, config.endpoint)}/api`;
    const token = Buffer.from(`${this.accessId}:${this.accessKey}`).toString('base64');
    this.authHeader = `Basic ${token}`;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  private captureCookies(response: Response): void {
    // Bun/undici expose getSetCookie(); fall back to the combined header.
    const setCookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : (response.headers.get('set-cookie') ? [response.headers.get('set-cookie') as string] : []);

    for (const cookie of setCookies) {
      const [pair] = cookie.split(';');
      if (!pair) continue;
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const val = pair.slice(eq + 1).trim();
      if (name) {
        this.cookies.set(name, val);
      }
    }
  }

  private cookieHeader(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return Array.from(this.cookies.entries())
      .map(([name, val]) => `${name}=${val}`)
      .join('; ');
  }

  /**
   * Make an authenticated request to the Sumo Logic API.
   * Uses HTTP Basic auth built from the Access ID and Access Key.
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: 'application/json',
      ...headers,
    };

    const cookie = this.cookieHeader();
    if (cookie) {
      requestHeaders.Cookie = cookie;
    }

    if (body && ['POST', 'PUT'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && ['POST', 'PUT'].includes(method)) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);
    this.captureCookies(response);

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    // Parse response body
    let data: unknown;
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const text = await response.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
    } else {
      data = await response.text();
    }

    // Sumo Logic error envelope: { id, errors: [{ code, message }] }
    if (!response.ok) {
      const errorData = data as SumoLogicErrorResponse | undefined;
      const errors = errorData?.errors;
      const message =
        errors?.map((e) => e.message).join(', ') ||
        errorData?.message ||
        response.statusText ||
        `Request failed with status ${response.status}`;
      throw new SumoLogicApiError(message, response.status, errors, errorData?.id);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  async put<T>(path: string, body?: Record<string, unknown> | unknown[] | string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  /**
   * The resolved API base URL (including `/api`).
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Get a preview of the Access ID (for display/debugging).
   */
  getAccessIdPreview(): string {
    if (this.accessId.length > 6) {
      return `${this.accessId.substring(0, 4)}...${this.accessId.substring(this.accessId.length - 2)}`;
    }
    return '***';
  }
}
