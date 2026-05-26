import type { SubstackConfig } from '../types';
import { SubstackApiError } from '../types';

/**
 * Get the Substack API base URL for a subdomain
 */
function getApiBase(subdomain: string): string {
  return `https://${subdomain}.substack.com/api/v1`;
}

export interface SubstackRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean | undefined>;
}

/**
 * Substack API Client
 * Uses cookie-based authentication with the substack.sid session token
 */
export class SubstackClient {
  private readonly subdomain: string;
  private readonly token: string;

  constructor(config: SubstackConfig) {
    if (!config.subdomain) {
      throw new Error('Substack subdomain is required');
    }
    if (!config.token) {
      throw new Error('Substack session token is required');
    }
    this.subdomain = config.subdomain;
    this.token = config.token;
  }

  /**
   * Get the API base URL
   */
  getApiBase(): string {
    return getApiBase(this.subdomain);
  }

  /**
   * Make a request to the Substack API
   */
  async request<T>(path: string, options: SubstackRequestOptions = {}): Promise<T> {
    const { method = 'GET', body, headers = {}, params } = options;

    let url = `${this.getApiBase()}${path}`;

    // Add query params
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

    const requestHeaders: Record<string, string> = {
      'Cookie': `substack.sid=${this.token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'connect-substack/0.0.1',
      ...headers,
    };

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
      credentials: 'include',
    };

    if (body) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    // Handle response
    let data: unknown;
    const contentType = response.headers.get('content-type') || '';

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
      let errorMessage = `Substack API Error: ${response.status} ${response.statusText}`;
      let errorCode: string | undefined;

      if (typeof data === 'object' && data !== null) {
        const errData = data as Record<string, unknown>;
        errorCode = errData.code as string | undefined;
        const errMsg = errData.message || errData.error || errData.errors;
        if (typeof errMsg === 'string') {
          errorMessage = errMsg;
        } else if (Array.isArray(errMsg) && errMsg.length > 0) {
          errorMessage = errMsg.map((e) => (typeof e === 'object' ? (e as Record<string, unknown>).message || JSON.stringify(e) : String(e))).join(', ');
        }
      } else if (typeof data === 'string' && data) {
        errorMessage = data;
      }

      throw new SubstackApiError(errorMessage, response.status, errorCode, requestId);
    }

    return data as T;
  }

  /**
   * Get the subdomain
   */
  getSubdomain(): string {
    return this.subdomain;
  }

  /**
   * Get a preview of the token (for display/debugging)
   */
  getTokenPreview(): string {
    if (this.token.length > 8) {
      return `${this.token.substring(0, 4)}...${this.token.substring(this.token.length - 4)}`;
    }
    return '***';
  }
}
