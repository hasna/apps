import type { SysdigConfig, OutputFormat, SysdigErrorDetail } from '../types';
import { SysdigApiError } from '../types';

// Sysdig SaaS region -> Monitor/API base URL.
// See https://docs.sysdig.com/en/administration/saas-regions-and-ip-ranges/
export const REGIONS: Record<string, string> = {
  us1: 'https://app.sysdigcloud.com',
  us2: 'https://us2.app.sysdig.com',
  us4: 'https://app.us4.sysdig.com',
  eu1: 'https://eu1.app.sysdig.com',
  eu2: 'https://app.eu2.sysdig.com',
  au1: 'https://app.au1.sysdig.com',
  me2: 'https://app.me2.sysdig.com',
  in1: 'https://app.in1.sysdig.com',
  jp1: 'https://app.jp1.sysdig.com',
};

export const SECURE_REGIONS: Record<string, string> = {
  ...REGIONS,
  us1: 'https://secure.sysdig.com',
};

export const DEFAULT_REGION = 'us1';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  format?: OutputFormat;
  product?: 'monitor' | 'secure';
}

/**
 * Resolve the API base URL from an explicit base URL or a region identifier.
 */
export function resolveBaseUrl(config: SysdigConfig): string {
  return resolveRegionBaseUrl(config, REGIONS);
}

/**
 * Resolve the Secure API base URL from an explicit base URL or a region identifier.
 */
export function resolveSecureBaseUrl(config: SysdigConfig): string {
  return resolveRegionBaseUrl(config, SECURE_REGIONS);
}

function resolveRegionBaseUrl(config: SysdigConfig, regions: Record<string, string>): string {
  if (config.baseUrl) {
    return config.baseUrl.replace(/\/+$/, '');
  }
  const region = (config.region || DEFAULT_REGION).toLowerCase();
  const base = regions[region];
  if (!base) {
    throw new Error(
      `Unknown Sysdig region "${region}". Supported regions: ${Object.keys(REGIONS).join(', ')}. ` +
        `Set SYSDIG_BASE_URL for on-prem installations.`,
    );
  }
  return base;
}

export class SysdigClient {
  private readonly apiToken: string;
  private readonly baseUrl: string;
  private readonly secureBaseUrl: string;

  constructor(config: SysdigConfig) {
    if (!config.apiToken) {
      throw new Error('API token is required');
    }
    this.apiToken = config.apiToken;
    this.baseUrl = resolveBaseUrl(config);
    this.secureBaseUrl = resolveSecureBaseUrl(config);
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getSecureBaseUrl(): string {
    return this.secureBaseUrl;
  }

  private buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    baseUrl = this.baseUrl,
  ): string {
    const url = new URL(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  /**
   * Make an authenticated request to the Sysdig API.
   * Uses the Authorization: Bearer <token> header.
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, product = 'monitor' } = options;

    const url = this.buildUrl(path, params, product === 'secure' ? this.secureBaseUrl : this.baseUrl);

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.apiToken}`,
      Accept: 'application/json',
      ...headers,
    };

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body !== undefined && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    // Parse response
    let data: unknown;
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();

    if (text && contentType.includes('application/json')) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    } else {
      data = text || undefined;
    }

    // Handle errors. Sysdig returns a variety of shapes:
    //   { errors: [{ reason, message }] }, { message }, or { error }
    if (!response.ok) {
      const errorData = (data ?? {}) as {
        errors?: SysdigErrorDetail[];
        message?: string;
        error?: string;
      };
      const errors = errorData.errors;
      const message =
        errors?.map(e => e.message || e.reason).filter(Boolean).join(', ') ||
        errorData.message ||
        errorData.error ||
        (typeof data === 'string' && data) ||
        response.statusText;
      throw new SysdigApiError(message, response.status, errors);
    }

    return data as T;
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    product?: RequestOptions['product'],
  ): Promise<T> {
    return this.request<T>(path, { method: 'GET', params, product });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | string | object,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown>, params });
  }

  async put<T>(
    path: string,
    body?: Record<string, unknown> | object,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: body as Record<string, unknown>, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  /**
   * Return a non-revealing token status for display/debugging.
   */
  getTokenPreview(): string {
    return this.apiToken ? 'configured' : 'not set';
  }
}
