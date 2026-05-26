import { PhotosApiError } from '../types';
import { getValidAccessToken } from '../utils/auth';

const PHOTOS_API_BASE = 'https://photoslibrary.googleapis.com/v1';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

export class PhotosClient {
  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${PHOTOS_API_BASE}${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    // Get fresh access token (handles refresh automatically)
    const accessToken = await getValidAccessToken();

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      ...headers,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      if (typeof body === 'string') {
        // For binary uploads, Content-Type should be set by caller
        if (!requestHeaders['Content-Type']) {
          requestHeaders['Content-Type'] = 'application/octet-stream';
        }
      } else {
        requestHeaders['Content-Type'] = 'application/json';
      }
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
      const errorData = data as { error?: { message?: string; code?: number; status?: string; details?: unknown[] } };
      const errorMessage = errorData?.error?.message || String(data || response.statusText);
      const errorStatus = errorData?.error?.status || 'UNKNOWN';
      throw new PhotosApiError(
        errorMessage,
        response.status,
        errorStatus,
        errorData?.error?.details as PhotosApiError['details']
      );
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[], params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  async put<T>(path: string, body?: Record<string, unknown>, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, params });
  }

  async patch<T>(path: string, body?: Record<string, unknown>, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  /**
   * Upload binary data to Google Photos
   * Returns an upload token that can be used to create media items
   */
  async uploadBytes(data: Buffer | Uint8Array, mimeType: string, filename?: string): Promise<string> {
    const accessToken = await getValidAccessToken();

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
      'X-Goog-Upload-Content-Type': mimeType,
      'X-Goog-Upload-Protocol': 'raw',
    };

    if (filename) {
      headers['X-Goog-Upload-File-Name'] = filename;
    }

    const response = await fetch('https://photoslibrary.googleapis.com/v1/uploads', {
      method: 'POST',
      headers,
      body: data,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new PhotosApiError(
        `Upload failed: ${text}`,
        response.status,
        'UPLOAD_FAILED'
      );
    }

    // Response body is the upload token (plain text)
    const uploadToken = await response.text();
    return uploadToken;
  }
}
