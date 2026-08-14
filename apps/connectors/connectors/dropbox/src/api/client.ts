import type { DropboxConfig, OutputFormat, DropboxErrorResponse } from '../types';
import { DropboxApiError } from '../types';

// Dropbox API endpoints
const API_BASE_URL = 'https://api.dropboxapi.com/2';
const CONTENT_BASE_URL = 'https://content.dropboxapi.com/2';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  format?: OutputFormat;
  endpoint?: 'api' | 'content'; // api for metadata, content for uploads/downloads
}

export class DropboxClient {
  private readonly accessToken: string;

  constructor(config: DropboxConfig) {
    if (!config.accessToken) {
      throw new Error('Access token is required');
    }
    this.accessToken = config.accessToken;
  }

  private getBaseUrl(endpoint: 'api' | 'content' = 'api'): string {
    return endpoint === 'content' ? CONTENT_BASE_URL : API_BASE_URL;
  }

  /**
   * Make an authenticated request to Dropbox API
   * Uses Bearer token authentication
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'POST', body, headers = {}, endpoint = 'api' } = options;

    const url = `${this.getBaseUrl(endpoint)}${path}`;

    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
      ...headers,
    };

    // Dropbox API uses JSON in the body for regular API calls
    if (endpoint === 'api' && body) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && endpoint === 'api') {
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
      let errorMessage: string;
      let errorTag: string | undefined;
      let userMessage: string | undefined;

      if (typeof data === 'object' && data !== null) {
        const errorData = data as DropboxErrorResponse;
        errorMessage = errorData.error_summary || JSON.stringify(data);
        errorTag = errorData.error?.['.tag'];
        userMessage = errorData.user_message?.text;
      } else {
        errorMessage = String(data || response.statusText);
      }

      throw new DropboxApiError(errorMessage, response.status, errorTag, userMessage);
    }

    return data as T;
  }

  /**
   * Make a content upload request (for file uploads)
   */
  async uploadRequest<T>(path: string, content: Uint8Array | string, arg: Record<string, unknown>): Promise<T> {
    const url = `${CONTENT_BASE_URL}${path}`;

    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify(arg),
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: requestHeaders,
      body: content,
    });

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
      let errorTag: string | undefined;

      if (typeof data === 'object' && data !== null) {
        const errorData = data as DropboxErrorResponse;
        errorMessage = errorData.error_summary || JSON.stringify(data);
        errorTag = errorData.error?.['.tag'];
      } else {
        errorMessage = String(data || response.statusText);
      }

      throw new DropboxApiError(errorMessage, response.status, errorTag);
    }

    return data as T;
  }

  /**
   * Make a content download request (for file downloads)
   * Returns the file content and metadata
   */
  async downloadRequest(path: string, arg: Record<string, unknown>): Promise<{ content: ArrayBuffer; metadata: unknown }> {
    const url = `${CONTENT_BASE_URL}${path}`;

    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Dropbox-API-Arg': JSON.stringify(arg),
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: requestHeaders,
    });

    // Handle errors
    if (!response.ok) {
      const text = await response.text();
      let errorMessage: string;
      let errorTag: string | undefined;

      try {
        const errorData = JSON.parse(text) as DropboxErrorResponse;
        errorMessage = errorData.error_summary || text;
        errorTag = errorData.error?.['.tag'];
      } catch {
        errorMessage = text || response.statusText;
      }

      throw new DropboxApiError(errorMessage, response.status, errorTag);
    }

    // Get metadata from header
    const metadataHeader = response.headers.get('Dropbox-API-Result');
    let metadata: unknown = {};
    if (metadataHeader) {
      try {
        metadata = JSON.parse(metadataHeader);
      } catch {
        // Ignore parse errors
      }
    }

    const content = await response.arrayBuffer();
    return { content, metadata };
  }

  /**
   * Shorthand for POST requests (most Dropbox API calls use POST)
   */
  async post<T>(path: string, body?: Record<string, unknown> | object): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown> });
  }

  /**
   * Get a preview of the access token (for display/debugging)
   */
  getAccessTokenPreview(): string {
    if (this.accessToken.length > 10) {
      return `${this.accessToken.substring(0, 6)}...${this.accessToken.substring(this.accessToken.length - 4)}`;
    }
    return '***';
  }
}
