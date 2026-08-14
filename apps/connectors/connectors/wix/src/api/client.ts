import type { WixConfig } from '../types';
import { WixApiError } from '../types';

export interface WixRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  siteId?: string; // Override site ID for this request
}

/**
 * Wix REST API Client
 * Uses API key authentication with site-level tokens
 *
 * Base URL: https://www.wixapis.com
 * Auth: Authorization header with API key
 * Site context: wix-site-id header for site-specific calls
 */
export class WixClient {
  private readonly apiKey: string;
  private readonly siteId?: string;
  private readonly accountId?: string;
  private readonly baseUrl = 'https://www.wixapis.com';

  constructor(config: WixConfig) {
    if (!config.apiKey) {
      throw new Error('Wix API key is required');
    }

    this.apiKey = config.apiKey;
    this.siteId = config.siteId;
    this.accountId = config.accountId;
  }

  /**
   * Make a request to the Wix REST API
   */
  async request<T>(endpoint: string, options: WixRequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, siteId } = options;

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
      'Authorization': this.apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...headers,
    };

    // Add site ID header if available
    const effectiveSiteId = siteId || this.siteId;
    if (effectiveSiteId) {
      requestHeaders['wix-site-id'] = effectiveSiteId;
    }

    // Add account ID header if available
    if (this.accountId) {
      requestHeaders['wix-account-id'] = this.accountId;
    }

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
      let errorMessage = `Wix API Error: ${response.status} ${response.statusText}`;
      let details: Record<string, unknown> | undefined;

      if (typeof data === 'object' && data !== null) {
        const errData = data as Record<string, unknown>;
        if (errData.message) {
          errorMessage = String(errData.message);
        }
        if (errData.details) {
          details = errData.details as Record<string, unknown>;
        }
      }

      throw new WixApiError(errorMessage, response.status, details);
    }

    return data as T;
  }

  /**
   * Get site ID
   */
  getSiteId(): string | undefined {
    return this.siteId;
  }

  /**
   * Get account ID
   */
  getAccountId(): string | undefined {
    return this.accountId;
  }

  /**
   * Get a preview of the API key (for display/debugging)
   */
  getApiKeyPreview(): string {
    if (this.apiKey.length > 12) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
