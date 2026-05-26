import type { RevolutConfig } from '../types';
import { RevolutApiError } from '../types';

// Revolut API base URLs
const PRODUCTION_BASE_URL = 'https://b2b.revolut.com/api/1.0';
const SANDBOX_BASE_URL = 'https://sandbox-b2b.revolut.com/api/1.0';

export interface RevolutRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Revolut Business API Client
 */
export class RevolutClient {
  private readonly apiToken: string;
  private readonly baseUrl: string;

  constructor(config: RevolutConfig) {
    if (!config.apiToken) {
      throw new Error('Revolut API token is required');
    }
    this.apiToken = config.apiToken;
    this.baseUrl = config.sandbox ? SANDBOX_BASE_URL : PRODUCTION_BASE_URL;
  }

  /**
   * Get base URL
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Check if using sandbox
   */
  isSandbox(): boolean {
    return this.baseUrl === SANDBOX_BASE_URL;
  }

  /**
   * Make a request to the Revolut API
   */
  async request<T>(
    path: string,
    options: RevolutRequestOptions = {}
  ): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const url = new URL(`${this.baseUrl}${path}`);

    // Add query params
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    // Prepare headers
    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...headers,
    };

    // Prepare body
    const fetchBody = body ? JSON.stringify(body) : undefined;

    const response = await fetch(url.toString(), {
      method,
      headers: requestHeaders,
      body: fetchBody,
    });

    // Handle response
    const contentType = response.headers.get('content-type') || '';
    let data: unknown;

    if (response.status === 204) {
      return {} as T;
    }

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
      const requestId = response.headers.get('x-request-id') || undefined;
      let errorMessage = `Revolut API Error: ${response.status} ${response.statusText}`;
      let errorCode: string | undefined;

      if (typeof data === 'object' && data !== null) {
        const errData = data as Record<string, unknown>;
        errorCode = errData.code as string | undefined;
        errorMessage = (errData.message || errData.error_description || errData.error || errorMessage) as string;
      }

      throw new RevolutApiError(errorMessage, response.status, errorCode, requestId);
    }

    return data as T;
  }

  /**
   * Get a preview of the API token (for display/debugging)
   */
  getTokenPreview(): string {
    if (this.apiToken.length > 12) {
      return `${this.apiToken.substring(0, 6)}...${this.apiToken.substring(this.apiToken.length - 4)}`;
    }
    return '***';
  }
}
