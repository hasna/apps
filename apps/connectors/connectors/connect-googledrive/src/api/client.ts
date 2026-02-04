import { DriveApiError } from '../types/index.ts';
import { getValidAccessToken } from '../utils/auth.ts';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API_BASE = 'https://www.googleapis.com/upload/drive/v3';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string | Buffer | Uint8Array;
  headers?: Record<string, string>;
  isUpload?: boolean;
  rawResponse?: boolean;
}

export class DriveClient {
  constructor() {}

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>, isUpload = false): string {
    const base = isUpload ? UPLOAD_API_BASE : DRIVE_API_BASE;
    const url = new URL(base + path);

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
    const { method = 'GET', params, body, headers = {}, isUpload = false, rawResponse = false } = options;

    // Get fresh access token (handles refresh automatically)
    const accessToken = await getValidAccessToken();

    const url = this.buildUrl(path, params, isUpload);

    const requestHeaders: Record<string, string> = {
      'Authorization': 'Bearer ' + accessToken,
      'Accept': 'application/json',
      ...headers,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      if (body instanceof Buffer || body instanceof Uint8Array) {
        // Binary upload - content type should be set in headers
      } else if (typeof body === 'string') {
        requestHeaders['Content-Type'] = 'application/json';
      } else {
        requestHeaders['Content-Type'] = 'application/json';
      }
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      if (body instanceof Buffer || body instanceof Uint8Array) {
        fetchOptions.body = body;
      } else if (typeof body === 'string') {
        fetchOptions.body = body;
      } else {
        fetchOptions.body = JSON.stringify(body);
      }
    }

    const response = await fetch(url, fetchOptions);

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    // Return raw response for downloads
    if (rawResponse) {
      return response as unknown as T;
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
      const errorData = data as { error?: { message?: string; code?: number; errors?: unknown[] } };
      const errorMessage = errorData?.error?.message || String(data || response.statusText);
      throw new DriveApiError(
        errorMessage,
        response.status,
        errorData?.error?.errors as DriveApiError['errors']
      );
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
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

  async upload<T>(path: string, content: Buffer | Uint8Array, metadata?: Record<string, unknown>, params?: Record<string, string | number | boolean | undefined>, mimeType?: string): Promise<T> {
    const accessToken = await getValidAccessToken();
    
    // Create multipart request
    const boundary = '-------314159265358979323846';
    const delimiter = '\r\n--' + boundary + '\r\n';
    const closeDelimiter = '\r\n--' + boundary + '--';
    
    let multipartBody = '';
    
    if (metadata) {
      multipartBody += delimiter;
      multipartBody += 'Content-Type: application/json; charset=UTF-8\r\n\r\n';
      multipartBody += JSON.stringify(metadata);
    }
    
    multipartBody += delimiter;
    multipartBody += 'Content-Type: ' + (mimeType || 'application/octet-stream') + '\r\n';
    multipartBody += 'Content-Transfer-Encoding: base64\r\n\r\n';
    
    const base64Content = Buffer.from(content).toString('base64');
    multipartBody += base64Content;
    multipartBody += closeDelimiter;

    const url = this.buildUrl(path, { ...params, uploadType: 'multipart' }, true);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'multipart/related; boundary=' + boundary,
      },
      body: multipartBody,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { error?: { message?: string; errors?: unknown[] } };
      throw new DriveApiError(
        errorData?.error?.message || response.statusText,
        response.status,
        errorData?.error?.errors as DriveApiError['errors']
      );
    }

    return response.json() as Promise<T>;
  }

  async download(fileId: string): Promise<ArrayBuffer> {
    const accessToken = await getValidAccessToken();
    const url = DRIVE_API_BASE + '/files/' + fileId + '?alt=media';

    const response = await fetch(url, {
      headers: {
        'Authorization': 'Bearer ' + accessToken,
      },
    });

    if (!response.ok) {
      throw new DriveApiError('Download failed: ' + response.statusText, response.status);
    }

    return response.arrayBuffer();
  }

  async export(fileId: string, mimeType: string): Promise<ArrayBuffer> {
    const accessToken = await getValidAccessToken();
    const url = DRIVE_API_BASE + '/files/' + fileId + '/export?mimeType=' + encodeURIComponent(mimeType);

    const response = await fetch(url, {
      headers: {
        'Authorization': 'Bearer ' + accessToken,
      },
    });

    if (!response.ok) {
      throw new DriveApiError('Export failed: ' + response.statusText, response.status);
    }

    return response.arrayBuffer();
  }
}
