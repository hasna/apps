import type { CloudflareConfig, CloudflareResponse, CloudflareError } from '../types';
import { CloudflareApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.cloudflare.com/client/v4';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | FormData | string;
  headers?: Record<string, string>;
  rawBody?: boolean;
  /** Skip Cloudflare standard response validation (for GraphQL, etc.) */
  rawResponse?: boolean;
}

export class CloudflareClient {
  private readonly apiToken?: string;
  private readonly apiKey?: string;
  private readonly email?: string;
  private readonly accountId?: string;
  private readonly baseUrl: string;

  constructor(config: CloudflareConfig) {
    if (!config.apiToken && !(config.apiKey && config.email)) {
      throw new Error('Either API token or (API key + email) is required');
    }
    this.apiToken = config.apiToken;
    this.apiKey = config.apiKey;
    this.email = config.email;
    this.accountId = config.accountId;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
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

  private getAuthHeaders(): Record<string, string> {
    if (this.apiToken) {
      return {
        'Authorization': `Bearer ${this.apiToken}`,
      };
    }
    if (this.apiKey && this.email) {
      return {
        'X-Auth-Key': this.apiKey,
        'X-Auth-Email': this.email,
      };
    }
    throw new Error('No valid authentication configured');
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, rawBody = false, rawResponse = false } = options;

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      ...this.getAuthHeaders(),
      ...headers,
    };

    if (body && !rawBody && !(body instanceof FormData)) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body) {
      if (body instanceof FormData) {
        fetchOptions.body = body;
      } else if (rawBody) {
        fetchOptions.body = body as string;
      } else {
        fetchOptions.body = JSON.stringify(body);
      }
    }

    const response = await fetch(url, fetchOptions);

    // Handle 204 No Content
    if (response.status === 204) {
      return { success: true, result: null, errors: [], messages: [] } as T;
    }

    // Parse response
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const text = await response.text();
      if (!text) {
        throw new CloudflareApiError('Empty response', response.status);
      }

      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new CloudflareApiError(`Invalid JSON response: ${text}`, response.status);
      }

      // For GraphQL and other raw responses, return data directly without validation
      if (rawResponse) {
        if (!response.ok) {
          throw new CloudflareApiError(`Request failed with status ${response.status}`, response.status);
        }
        return data as T;
      }

      // Standard Cloudflare API response handling
      const cfResponse = data as CloudflareResponse<T>;

      if (!cfResponse.success) {
        const errorMessages = cfResponse.errors?.map((e: CloudflareError) => e.message).join(', ') || 'Unknown error';
        throw new CloudflareApiError(errorMessages, response.status, cfResponse.errors);
      }

      // Return the full response with result_info for pagination
      return cfResponse as T;
    } else {
      const text = await response.text();
      // Some endpoints return raw text (like Worker scripts)
      if (!response.ok) {
        throw new CloudflareApiError(text || response.statusText, response.status);
      }
      return text as T;
    }
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<CloudflareResponse<T>> {
    return this.request<CloudflareResponse<T>>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown>, params?: Record<string, string | number | boolean | undefined>): Promise<CloudflareResponse<T>> {
    return this.request<CloudflareResponse<T>>(path, { method: 'POST', body, params });
  }

  async put<T>(path: string, body?: Record<string, unknown>, params?: Record<string, string | number | boolean | undefined>): Promise<CloudflareResponse<T>> {
    return this.request<CloudflareResponse<T>>(path, { method: 'PUT', body, params });
  }

  async patch<T>(path: string, body?: Record<string, unknown>, params?: Record<string, string | number | boolean | undefined>): Promise<CloudflareResponse<T>> {
    return this.request<CloudflareResponse<T>>(path, { method: 'PATCH', body, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<CloudflareResponse<T>> {
    return this.request<CloudflareResponse<T>>(path, { method: 'DELETE', params });
  }

  // Special method for uploading Worker scripts (multipart/form-data)
  async uploadWorkerScript(accountId: string, scriptName: string, script: string, metadata?: Record<string, unknown>): Promise<CloudflareResponse<unknown>> {
    const formData = new FormData();

    // Add the script as a file
    const scriptBlob = new Blob([script], { type: 'application/javascript' });
    formData.append('script', scriptBlob, 'index.js');

    // Add metadata if provided
    if (metadata) {
      const metadataBlob = new Blob([JSON.stringify(metadata)], { type: 'application/json' });
      formData.append('metadata', metadataBlob);
    }

    return this.request<CloudflareResponse<unknown>>(
      `/accounts/${accountId}/workers/scripts/${scriptName}`,
      {
        method: 'PUT',
        body: formData,
      }
    );
  }

  // Get account ID (from config or needs to be fetched)
  getAccountId(): string | undefined {
    return this.accountId;
  }

  // Utility to get API key/token preview (for display/debugging)
  getCredentialPreview(): string {
    if (this.apiToken) {
      return `Token: ${this.apiToken.substring(0, 8)}...`;
    }
    if (this.apiKey) {
      return `Key: ${this.apiKey.substring(0, 8)}... (${this.email})`;
    }
    return 'No credentials';
  }
}
