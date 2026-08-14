import type { MailchimpConfig, OutputFormat } from '../types';
import { MailchimpApiError } from '../types';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  format?: OutputFormat;
}

/**
 * Extract data center from Mailchimp API key
 * API keys are in format: abc123def456-us1
 * The suffix after the dash is the data center
 */
function extractDataCenter(apiKey: string): string {
  const parts = apiKey.split('-');
  if (parts.length < 2) {
    throw new Error('Invalid Mailchimp API key format. Expected format: key-dc (e.g., abc123-us1)');
  }
  return parts[parts.length - 1];
}

export class MailchimpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: MailchimpConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;

    // Extract data center from API key or use provided serverPrefix
    const serverPrefix = config.serverPrefix || extractDataCenter(config.apiKey);
    this.baseUrl = `https://${serverPrefix}.api.mailchimp.com/3.0`;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);

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
   * Make an authenticated request to Mailchimp API
   * Uses Basic auth with "anystring" as username and API key as password
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const url = this.buildUrl(path, params);

    // Mailchimp uses Basic auth with "anystring:apiKey"
    const authString = Buffer.from(`anystring:${this.apiKey}`).toString('base64');

    const requestHeaders: Record<string, string> = {
      'Authorization': `Basic ${authString}`,
      'Accept': 'application/json',
      ...headers,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
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

    // Handle errors - Mailchimp returns detailed error objects
    if (!response.ok) {
      const errorData = data as Record<string, unknown> | undefined;
      const message = errorData?.detail as string || errorData?.title as string || response.statusText;
      throw new MailchimpApiError(
        message,
        response.status,
        errorData?.type as string,
        errorData?.title as string,
        errorData?.detail as string,
        errorData?.errors as Array<{ field?: string; message: string }>
      );
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string | object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown>, params });
  }

  async put<T>(path: string, body?: Record<string, unknown> | object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: body as Record<string, unknown>, params });
  }

  async patch<T>(path: string, body?: Record<string, unknown> | object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body: body as Record<string, unknown>, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  /**
   * Get a preview of the API key (for display/debugging)
   */
  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }

  /**
   * Get the base URL (useful for debugging)
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }
}
