import type {
  TotpCode,
  TotpConfig,
  TotpEvent,
  TotpListResponse,
  TotpRawRequestOptions,
  TotpSearchRequest,
} from '../types';
import { TotpClient } from './client';

export { TotpClient, DEFAULT_BASE_URL } from './client';

export class Totp {
  private readonly client: TotpClient;

  constructor(config: TotpConfig) {
    this.client = new TotpClient(config);
  }

  static fromEnv(): Totp {
    const apiKey = process.env.TOTP_API_KEY;
    if (!apiKey) {
      throw new Error('TOTP_API_KEY is required');
    }
    return new Totp({
      apiKey,
      baseUrl: process.env.TOTP_BASE_URL,
    });
  }

  async listCodes(params?: Record<string, string | number | boolean | undefined>): Promise<TotpListResponse<TotpCode>> {
    return this.client.request<TotpListResponse<TotpCode>>('/codes', { params });
  }

  async createCode(body: Record<string, unknown>): Promise<TotpCode> {
    return this.client.request<TotpCode>('/codes', { method: 'POST', body });
  }

  async getCode(codeId: string): Promise<TotpCode> {
    const encoded = this.client.encodePathSegment(codeId);
    return this.client.request<TotpCode>(`/codes/${encoded}`);
  }

  async listEvents(params?: Record<string, string | number | boolean | undefined>): Promise<TotpListResponse<TotpEvent>> {
    return this.client.request<TotpListResponse<TotpEvent>>('/events', { params });
  }

  async search(body: TotpSearchRequest): Promise<unknown> {
    return this.client.request('/search', { method: 'POST', body });
  }

  async rawRequest(options: TotpRawRequestOptions): Promise<unknown> {
    const method = (options.method || 'GET').toUpperCase();
    const path = options.path.startsWith('/') ? options.path : `/${options.path}`;
    return this.client.request(path, {
      method,
      params: options.query,
      body: options.body,
      headers: options.headers,
    });
  }

  getClient(): TotpClient {
    return this.client;
  }
}
