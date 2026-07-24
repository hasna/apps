import type { ConnectorClient, RequestOptions } from './client';

/**
 * Escape hatch for calling any Tave API endpoint directly.
 *
 * Tave's public API surface is not exhaustively documented, so this lets
 * callers reach endpoints that do not have a dedicated resource wrapper yet.
 */
export class RawApi {
  constructor(private readonly client: ConnectorClient) {}

  async request<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
    return this.client.request<T>(path, options);
  }

  async get<T = unknown>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.client.get<T>(path, params);
  }

  async post<T = unknown>(path: string, body?: Record<string, unknown> | unknown[] | string): Promise<T> {
    return this.client.post<T>(path, body);
  }
}
