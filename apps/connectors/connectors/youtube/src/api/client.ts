import type { YouTubeConfig, OutputFormat, YouTubeApiErrorResponse } from '../types';
import { YouTubeApiError } from '../types';

const DEFAULT_BASE_URL = 'https://www.googleapis.com/youtube/v3';
const DEFAULT_UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3';
const DEFAULT_ANALYTICS_URL = 'https://youtubeanalytics.googleapis.com/v2';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | string[] | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  format?: OutputFormat;
  useUploadUrl?: boolean;
  useAnalyticsUrl?: boolean;
}

export interface UploadOptions extends RequestOptions {
  contentType: string;
  contentLength: number;
}

export class YouTubeClient {
  private readonly accessToken?: string;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly uploadUrl: string;
  private readonly analyticsUrl: string;

  constructor(config: YouTubeConfig) {
    if (!config.accessToken && !config.apiKey) {
      throw new Error('Either access token or API key is required');
    }
    this.accessToken = config.accessToken;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.uploadUrl = config.uploadUrl || DEFAULT_UPLOAD_URL;
    this.analyticsUrl = config.analyticsUrl || DEFAULT_ANALYTICS_URL;
  }

  private getBaseUrlForRequest(options: RequestOptions): string {
    if (options.useUploadUrl) {
      return this.uploadUrl;
    }
    if (options.useAnalyticsUrl) {
      return this.analyticsUrl;
    }
    return this.baseUrl;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | string[] | undefined>, options: RequestOptions = {}): string {
    const baseUrl = this.getBaseUrlForRequest(options);
    const url = new URL(`${baseUrl}${path}`);

    // Add API key if using API key auth and not using OAuth
    if (this.apiKey && !this.accessToken) {
      url.searchParams.append('key', this.apiKey);
    }

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          if (Array.isArray(value)) {
            url.searchParams.append(key, value.join(','));
          } else {
            url.searchParams.append(key, String(value));
          }
        }
      });
    }

    return url.toString();
  }

  /**
   * Make an authenticated request to YouTube API
   * YouTube uses OAuth 2.0 Bearer token or API key
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const url = this.buildUrl(path, params, options);

    const requestHeaders: Record<string, string> = {
      'Accept': 'application/json',
      ...headers,
    };

    // Add OAuth Bearer token if available
    if (this.accessToken) {
      requestHeaders['Authorization'] = `Bearer ${this.accessToken}`;
    }

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

    // Handle errors
    if (!response.ok) {
      const errorResponse = data as YouTubeApiErrorResponse;
      const errorMessage = errorResponse?.error?.message ||
        (typeof data === 'object' && data !== null ? JSON.stringify(data) : String(data || response.statusText));
      const errors = errorResponse?.error?.errors;
      throw new YouTubeApiError(errorMessage, response.status, errors);
    }

    return data as T;
  }

  /**
   * Initialize a resumable upload session
   */
  async initResumableUpload(
    path: string,
    metadata: Record<string, unknown>,
    contentType: string,
    contentLength: number
  ): Promise<string> {
    const url = this.buildUrl(path, { uploadType: 'resumable' }, { useUploadUrl: true });

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': contentType,
      'X-Upload-Content-Length': String(contentLength),
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(metadata),
    });

    if (!response.ok) {
      const text = await response.text();
      let errorData: YouTubeApiErrorResponse | undefined;
      try {
        errorData = JSON.parse(text);
      } catch {
        // Not JSON
      }
      throw new YouTubeApiError(
        errorData?.error?.message || text || response.statusText,
        response.status,
        errorData?.error?.errors
      );
    }

    const uploadUrl = response.headers.get('Location');
    if (!uploadUrl) {
      throw new Error('No upload URL returned');
    }

    return uploadUrl;
  }

  /**
   * Upload a chunk to a resumable upload session
   */
  async uploadChunk(
    uploadUrl: string,
    chunk: Uint8Array,
    startByte: number,
    totalSize: number
  ): Promise<{ complete: boolean; bytesUploaded: number; response?: unknown }> {
    const endByte = startByte + chunk.length - 1;
    const contentRange = `bytes ${startByte}-${endByte}/${totalSize}`;

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': String(chunk.length),
        'Content-Range': contentRange,
      },
      body: chunk as unknown as BodyInit,
    });

    if (response.status === 200 || response.status === 201) {
      // Upload complete
      const data = await response.json();
      return { complete: true, bytesUploaded: totalSize, response: data };
    }

    if (response.status === 308) {
      // Upload incomplete, need more chunks
      const range = response.headers.get('Range');
      const bytesUploaded = range ? parseInt(range.split('-')[1]) + 1 : startByte + chunk.length;
      return { complete: false, bytesUploaded };
    }

    // Error
    const text = await response.text();
    let errorData: YouTubeApiErrorResponse | undefined;
    try {
      errorData = JSON.parse(text);
    } catch {
      // Not JSON
    }
    throw new YouTubeApiError(
      errorData?.error?.message || text || response.statusText,
      response.status,
      errorData?.error?.errors
    );
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | string[] | undefined>, options?: Omit<RequestOptions, 'method' | 'params'>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params, ...options });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string, params?: Record<string, string | number | boolean | string[] | undefined>, options?: Omit<RequestOptions, 'method' | 'body' | 'params'>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params, ...options });
  }

  async put<T>(path: string, body?: Record<string, unknown>, params?: Record<string, string | number | boolean | string[] | undefined>, options?: Omit<RequestOptions, 'method' | 'body' | 'params'>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, params, ...options });
  }

  async patch<T>(path: string, body?: Record<string, unknown>, params?: Record<string, string | number | boolean | string[] | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | string[] | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  /**
   * Get a preview of the access token (for display/debugging)
   */
  getTokenPreview(): string {
    if (this.accessToken && this.accessToken.length > 10) {
      return `${this.accessToken.substring(0, 6)}...${this.accessToken.substring(this.accessToken.length - 4)}`;
    }
    if (this.apiKey && this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)} (API Key)`;
    }
    return '***';
  }

  /**
   * Check if client has OAuth token (required for write operations)
   */
  hasOAuthToken(): boolean {
    return !!this.accessToken;
  }
}
