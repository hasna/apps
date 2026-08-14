import { SpongeClient, type QueryValue } from './client';
import type { HttpMethod } from '../types';

/**
 * Raw API — escape hatch for calling any Sponge endpoint not yet wrapped by a
 * dedicated method. Handles authentication and JSON encoding for you.
 */
export class RawApi {
  constructor(private readonly client: SpongeClient) {}

  request(
    path: string,
    options: {
      method?: HttpMethod;
      params?: Record<string, QueryValue>;
      body?: unknown;
    } = {},
  ): Promise<unknown> {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return this.client.request(normalizedPath, {
      method: options.method ?? 'GET',
      params: options.params,
      body: options.body,
    });
  }
}
