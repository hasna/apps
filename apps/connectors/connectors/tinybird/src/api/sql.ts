import type { ResponseFormat } from '../types';
import type { TinybirdClient } from './client';

export class SqlApi {
  constructor(private readonly client: TinybirdClient) {}

  async query(options: { q: string; format?: ResponseFormat }): Promise<unknown> {
    return this.client.request('/v0/sql', {
      params: { q: options.q, format: options.format ?? 'json' },
    });
  }
}
