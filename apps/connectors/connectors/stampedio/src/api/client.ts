import type { StampedioConfig } from '../types';
import { StampedioApiError } from '../types';

const DEFAULT_BASE_URL = 'https://stamped.io/api';

export interface StampedioRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[];
}

/**
 * HTTP transport for the Stamped.io REST API.
 *
 * Private endpoints include the configured ShopId/storeHash in the path and
 * authenticate with the private API key in the `stamped-api-key` header. Public
 * widget endpoints (`/widget/...`) use the public key and storefront domain as
 * query parameters.
 */
export class StampedioClient {
  private readonly publicKey?: string;
  private readonly privateKey: string;
  private readonly shopId: string;
  private readonly storeUrl?: string;
  private readonly baseUrl: string;

  constructor(config: StampedioConfig) {
    if (!config.privateKey) throw new Error('Stamped.io private key is required');
    if (!config.storeHash) throw new Error('Stamped.io store hash is required');
    this.publicKey = config.publicKey || undefined;
    this.privateKey = config.privateKey;
    this.shopId = config.storeHash;
    this.storeUrl = config.storeUrl;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  private buildUrl(path: string, params?: StampedioRequestOptions['params']): URL {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }
    return url;
  }

  private async parse<T>(response: Response): Promise<T> {
    if (response.status === 204) return {} as T;
    const text = await response.text();
    let data: unknown = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!response.ok) {
      const message =
        (data && typeof data === 'object' && 'error' in data && String((data as Record<string, unknown>).error)) ||
        (data && typeof data === 'object' && 'message' in data && String((data as Record<string, unknown>).message)) ||
        (typeof data === 'string' && data) ||
        `Stamped.io API error: ${response.status} ${response.statusText}`;
      throw new StampedioApiError(String(message), response.status);
    }
    return data as T;
  }

  /** Insert the configured ShopId/storeHash into a Reviews V2 merchant path. */
  storePath(suffix: string): string {
    const clean = suffix.startsWith('/') ? suffix : `/${suffix}`;
    return `/v2/${encodeURIComponent(this.shopId)}${clean}`;
  }

  /** Insert the configured ShopId/storeHash into a Merchant Data V3 path. */
  merchantPath(suffix: string): string {
    const clean = suffix.startsWith('/') ? suffix : `/${suffix}`;
    return `/v3/merchant/shops/${encodeURIComponent(this.shopId)}${clean}`;
  }

  /** Insert the configured ShopId/storeHash into a Loyalty V3 path. */
  loyaltyPath(suffix: string): string {
    const clean = suffix.startsWith('/') ? suffix : `/${suffix}`;
    return `/v3/loyalty/shops/${encodeURIComponent(this.shopId)}${clean}`;
  }

  /** Authenticated private request (`stamped-api-key` header). */
  async request<T>(path: string, options: StampedioRequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body } = options;
    const url = this.buildUrl(path, params);
    const headers: Record<string, string> = {
      'stamped-api-key': this.privateKey,
      Accept: 'application/json',
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined && method !== 'GET' && method !== 'DELETE') {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const response = await fetch(url.toString(), init);
    return this.parse<T>(response);
  }

  /**
   * Unauthenticated public widget request. The public key and storefront domain
   * are appended as query parameters instead of a private auth header.
   */
  async publicRequest<T>(path: string, options: StampedioRequestOptions = {}): Promise<T> {
    if (!this.publicKey) {
      throw new Error('Stamped.io public key is required for public widget requests');
    }
    const { method = 'GET', params } = options;
    const url = this.buildUrl(path, {
      ...params,
      apiKey: this.publicKey,
      storeUrl: this.storeUrl,
    });
    const response = await fetch(url.toString(), {
      method,
      headers: { Accept: 'application/json' },
    });
    return this.parse<T>(response);
  }

  getStoreHash(): string {
    return this.shopId;
  }

  getShopId(): string {
    return this.shopId;
  }
}
