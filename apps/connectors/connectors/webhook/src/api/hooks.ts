import type { ConnectorClient } from './client';
import type { CreateHookParams, Hook, ListHooksParams } from '../types';

export class HooksApi {
  constructor(private readonly client: ConnectorClient) {}

  /** GET /hooks */
  async list(params?: ListHooksParams): Promise<Hook[] | Record<string, unknown>> {
    return this.client.get('/hooks', params as Record<string, string | number | boolean | undefined>);
  }

  /** POST /hooks */
  async create(body: CreateHookParams): Promise<Hook | Record<string, unknown>> {
    return this.client.post('/hooks', body);
  }

  /** GET /hooks/{hookId} */
  async get(hookId: string): Promise<Hook | Record<string, unknown>> {
    return this.client.get(`/hooks/${encodeURIComponent(hookId)}`);
  }
}
