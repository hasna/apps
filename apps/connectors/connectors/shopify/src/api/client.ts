import type { ShopifyConfig } from '../types';
import { ShopifyApiError } from '../types';
import { normalizeStoreName } from '../utils/config';

export interface ShopifyRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Shopify Admin API Client
 * Uses REST API with access token authentication
 */
export class ShopifyClient {
  private readonly store: string;
  private readonly accessToken: string;
  private readonly apiVersion: string;
  private readonly baseUrl: string;

  constructor(config: ShopifyConfig) {
    if (!config.store) {
      throw new Error('Shopify store is required');
    }
    if (!config.accessToken) {
      throw new Error('Shopify access token is required');
    }

    this.store = normalizeStoreName(config.store);
    this.accessToken = config.accessToken;
    this.apiVersion = config.apiVersion || '2024-01';
    this.baseUrl = `https://${this.store}/admin/api/${this.apiVersion}`;
  }

  /**
   * Make a request to the Shopify Admin API
   */
  async request<T>(endpoint: string, options: ShopifyRequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    // Build URL with query params
    let url = `${this.baseUrl}${endpoint}`;
    if (params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      });
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    // Build headers
    const requestHeaders: Record<string, string> = {
      'X-Shopify-Access-Token': this.accessToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...headers,
    };

    // Make request
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Handle response
    if (response.status === 204) {
      return {} as T;
    }

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

    if (!response.ok) {
      let errorMessage = `Shopify API Error: ${response.status} ${response.statusText}`;
      let errors: Record<string, string[]> | string | undefined;

      if (typeof data === 'object' && data !== null) {
        const errData = data as Record<string, unknown>;
        if (errData.errors) {
          errors = errData.errors as Record<string, string[]> | string;
          if (typeof errors === 'string') {
            errorMessage = errors;
          } else if (typeof errors === 'object') {
            errorMessage = Object.entries(errors)
              .map(([field, msgs]) => `${field}: ${Array.isArray(msgs) ? msgs.join(', ') : msgs}`)
              .join('; ');
          }
        } else if (errData.error) {
          errorMessage = String(errData.error);
        }
      }

      throw new ShopifyApiError(errorMessage, response.status, errors);
    }

    return data as T;
  }

  /**
   * Parse Link header for pagination
   */
  parseLinkHeader(linkHeader: string | null): { next?: string; previous?: string } {
    if (!linkHeader) return {};

    const links: { next?: string; previous?: string } = {};
    const parts = linkHeader.split(',');

    for (const part of parts) {
      const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
      if (match) {
        const [, url, rel] = match;
        if (rel === 'next') links.next = url;
        if (rel === 'previous') links.previous = url;
      }
    }

    return links;
  }

  /**
   * Get store name
   */
  getStore(): string {
    return this.store;
  }

  /**
   * Get API version
   */
  getApiVersion(): string {
    return this.apiVersion;
  }

  /**
   * Get a preview of the access token (for display/debugging)
   */
  getAccessTokenPreview(): string {
    if (this.accessToken.length > 12) {
      return `${this.accessToken.substring(0, 6)}...${this.accessToken.substring(this.accessToken.length - 4)}`;
    }
    return '***';
  }
}
