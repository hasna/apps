import type { TransformClient } from './client';
import type { RawRequestOptions } from '../types';

export class RawApi {
  constructor(private readonly client: TransformClient) {}

  request<T = unknown>(options: RawRequestOptions): Promise<T> {
    const { method = 'GET', path, query, body, headers } = options;
    return this.client.request<T>(path, { method, params: query, body, headers });
  }
}
