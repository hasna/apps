import type { WebflowConfig } from '../types';
import { WebflowApiError } from '../types';

export interface WebflowRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Webflow API v2 Client
 * Uses REST API with Bearer token authentication
 */
export class WebflowClient {
  private readonly accessToken: string;
  private readonly baseUrl: string = 'https://api.webflow.com/v2';

  constructor(config: WebflowConfig) {
    if (!config.accessToken) {
      throw new Error('Webflow access token is required');
    }

    this.accessToken = config.accessToken;
  }

  /**
   * Make a request to the Webflow API v2
   */
  async request<T>(endpoint: string, options: WebflowRequestOptions = {}): Promise<T> {
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
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
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
      let errorMessage = `Webflow API Error: ${response.status} ${response.statusText}`;
      let code: string | undefined;
      let details: Record<string, unknown> | undefined;

      if (typeof data === 'object' && data !== null) {
        const errData = data as Record<string, unknown>;
        if (errData.message) {
          errorMessage = String(errData.message);
        }
        if (errData.code) {
          code = String(errData.code);
        }
        if (errData.details) {
          details = errData.details as Record<string, unknown>;
        }
        // Handle v2 error format
        if (errData.err) {
          errorMessage = String(errData.err);
        }
      }

      throw new WebflowApiError(errorMessage, response.status, code, details);
    }

    return data as T;
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
