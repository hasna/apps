import type { TelegramConfig, TelegramApiResponse } from '../types';
import { TelegramApiError } from '../types';

const TELEGRAM_API_BASE = 'https://api.telegram.org';

export interface TelegramRequestOptions {
  method?: 'GET' | 'POST';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | FormData;
}

/**
 * Telegram Bot API Client
 */
export class TelegramClient {
  private readonly botToken: string;
  private readonly baseUrl: string;

  constructor(config: TelegramConfig) {
    if (!config.botToken) {
      throw new Error('Telegram Bot Token is required');
    }
    this.botToken = config.botToken;
    this.baseUrl = `${TELEGRAM_API_BASE}/bot${this.botToken}`;
  }

  /**
   * Make a request to the Telegram Bot API
   */
  async request<T>(
    method: string,
    options: TelegramRequestOptions = {}
  ): Promise<T> {
    const { method: httpMethod = 'POST', params, body } = options;

    let url = `${this.baseUrl}/${method}`;

    // Add query params for GET requests
    if (params && httpMethod === 'GET') {
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

    const headers: Record<string, string> = {};
    let fetchBody: BodyInit | undefined;

    if (body) {
      if (body instanceof FormData) {
        // Let the browser set the content-type with boundary for FormData
        fetchBody = body;
      } else {
        headers['Content-Type'] = 'application/json';
        fetchBody = JSON.stringify(body);
      }
    } else if (params && httpMethod === 'POST') {
      // For POST without body, send params as JSON body
      headers['Content-Type'] = 'application/json';
      const cleanParams: Record<string, unknown> = {};
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          cleanParams[key] = value;
        }
      });
      fetchBody = JSON.stringify(cleanParams);
    }

    const response = await fetch(url, {
      method: httpMethod,
      headers,
      body: fetchBody,
    });

    const data = await response.json() as TelegramApiResponse<T>;

    if (!data.ok) {
      throw new TelegramApiError(
        data.description || 'Unknown Telegram API error',
        response.status,
        data.error_code
      );
    }

    return data.result as T;
  }

  /**
   * Upload a file to Telegram
   */
  async uploadFile<T>(
    method: string,
    fileField: string,
    fileData: Uint8Array,
    fileName: string,
    additionalParams: Record<string, string | number | boolean | undefined> = {}
  ): Promise<T> {
    const formData = new FormData();

    // Add the file - create a proper ArrayBuffer from Uint8Array
    const arrayBuffer = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength) as ArrayBuffer;
    const blob = new Blob([arrayBuffer]);
    formData.append(fileField, blob, fileName);

    // Add additional params
    Object.entries(additionalParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        formData.append(key, String(value));
      }
    });

    return this.request<T>(method, { body: formData });
  }

  /**
   * Download a file returned by the Telegram Bot API
   */
  async downloadFile(filePath: string): Promise<Uint8Array> {
    const normalizedPath = filePath.replace(/^\/+/, '');
    if (!normalizedPath) {
      throw new Error('Telegram file path is required');
    }

    const encodedPath = normalizedPath
      .split('/')
      .map(segment => encodeURIComponent(segment))
      .join('/');
    const url = `${TELEGRAM_API_BASE}/file/bot${this.botToken}/${encodedPath}`;

    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      throw new Error('Failed to download Telegram file');
    }

    if (!response.ok) {
      throw new TelegramApiError(
        `Telegram file download failed with HTTP ${response.status}`,
        response.status
      );
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  /**
   * Get a preview of the bot token (for display/debugging)
   */
  getTokenPreview(): string {
    if (this.botToken.length > 10) {
      const parts = this.botToken.split(':');
      if (parts.length === 2) {
        return `${parts[0]}:****`;
      }
      return `${this.botToken.substring(0, 6)}...`;
    }
    return '***';
  }
}
