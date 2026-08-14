import type { SupabaseConfig, OutputFormat, SupabaseErrorResponse } from '../types';
import { SupabaseApiError } from '../types';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string | ArrayBuffer;
  headers?: Record<string, string>;
  format?: OutputFormat;
  apiType?: 'rest' | 'auth' | 'storage' | 'functions';
}

export class SupabaseClient {
  private readonly projectUrl: string;
  private readonly serviceRoleKey?: string;
  private readonly anonKey?: string;

  constructor(config: SupabaseConfig) {
    if (!config.projectUrl) {
      throw new Error('Project URL is required');
    }
    if (!config.serviceRoleKey && !config.anonKey) {
      throw new Error('Service role key or anon key is required');
    }
    this.projectUrl = config.projectUrl.replace(/\/$/, ''); // Remove trailing slash
    this.serviceRoleKey = config.serviceRoleKey;
    this.anonKey = config.anonKey;
  }

  private getApiKey(): string {
    return this.serviceRoleKey || this.anonKey || '';
  }

  private getBaseUrl(apiType: RequestOptions['apiType'] = 'rest'): string {
    switch (apiType) {
      case 'auth':
        return `${this.projectUrl}/auth/v1`;
      case 'storage':
        return `${this.projectUrl}/storage/v1`;
      case 'functions':
        return `${this.projectUrl}/functions/v1`;
      case 'rest':
      default:
        return `${this.projectUrl}/rest/v1`;
    }
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>, apiType?: RequestOptions['apiType']): string {
    const url = new URL(`${this.getBaseUrl(apiType)}${path}`);

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
   * Make an authenticated request to Supabase API
   * Uses apikey header and Bearer token authentication
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, apiType = 'rest' } = options;

    const url = this.buildUrl(path, params, apiType);
    const apiKey = this.getApiKey();

    const requestHeaders: Record<string, string> = {
      'apikey': apiKey,
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
      ...headers,
    };

    // For service role operations, add admin flag
    if (this.serviceRoleKey && apiType === 'auth') {
      requestHeaders['Authorization'] = `Bearer ${this.serviceRoleKey}`;
    }

    if (body && ['POST', 'PUT', 'PATCH'].includes(method) && !(body instanceof ArrayBuffer)) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      if (body instanceof ArrayBuffer) {
        fetchOptions.body = body;
      } else {
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
      }
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

    // Handle errors
    if (!response.ok) {
      let errorMessage: string;
      let errorCode: string | undefined;
      let hint: string | undefined;

      if (typeof data === 'object' && data !== null) {
        const errorData = data as SupabaseErrorResponse;
        errorMessage = errorData.message || errorData.error_description || errorData.error || errorData.msg || JSON.stringify(data);
        errorCode = errorData.code;
        hint = errorData.hint;
      } else {
        errorMessage = String(data || response.statusText);
      }

      throw new SupabaseApiError(errorMessage, response.status, errorCode, hint);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>, apiType?: RequestOptions['apiType']): Promise<T> {
    return this.request<T>(path, { method: 'GET', params, apiType });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string | object, apiType?: RequestOptions['apiType']): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown>, apiType });
  }

  async put<T>(path: string, body?: Record<string, unknown> | object, apiType?: RequestOptions['apiType']): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: body as Record<string, unknown>, apiType });
  }

  async patch<T>(path: string, body?: Record<string, unknown> | object, apiType?: RequestOptions['apiType']): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body: body as Record<string, unknown>, apiType });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>, apiType?: RequestOptions['apiType']): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params, apiType });
  }

  /**
   * Upload file to storage
   */
  async uploadFile(bucket: string, path: string, content: ArrayBuffer, contentType?: string): Promise<{ Key: string }> {
    const url = `${this.getBaseUrl('storage')}/object/${bucket}/${path}`;
    const apiKey = this.getApiKey();

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': contentType || 'application/octet-stream',
      },
      body: content,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new SupabaseApiError(text, response.status);
    }

    return response.json();
  }

  /**
   * Download file from storage
   */
  async downloadFile(bucket: string, path: string): Promise<ArrayBuffer> {
    const url = `${this.getBaseUrl('storage')}/object/${bucket}/${path}`;
    const apiKey = this.getApiKey();

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new SupabaseApiError(text, response.status);
    }

    return response.arrayBuffer();
  }

  /**
   * Get a preview of the API key (for display/debugging)
   */
  getApiKeyPreview(): string {
    const key = this.getApiKey();
    if (key.length > 10) {
      return `${key.substring(0, 6)}...${key.substring(key.length - 4)}`;
    }
    return '***';
  }

  /**
   * Get project URL
   */
  getProjectUrl(): string {
    return this.projectUrl;
  }
}
