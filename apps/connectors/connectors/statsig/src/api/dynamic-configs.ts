import type { StatsigClient } from './client';
import type { JsonRecord } from '../types';

function encodeId(id: string): string {
  return encodeURIComponent(id);
}

/** @see https://docs.statsig.com/console-api/dynamic-configs */
export class DynamicConfigsApi {
  constructor(private readonly client: StatsigClient) {}

  list(): Promise<unknown> {
    return this.client.get('/dynamic-configs');
  }

  get(id: string): Promise<unknown> {
    return this.client.get(`/dynamic-configs/${encodeId(id)}`);
  }

  create(body: JsonRecord): Promise<unknown> {
    return this.client.post('/dynamic-configs', body);
  }

  update(id: string, patch: JsonRecord, mode: 'PUT' | 'PATCH' = 'PATCH'): Promise<unknown> {
    const path = `/dynamic-configs/${encodeId(id)}`;
    return mode === 'PUT' ? this.client.put(path, patch) : this.client.patch(path, patch);
  }

  delete(id: string): Promise<unknown> {
    return this.client.delete(`/dynamic-configs/${encodeId(id)}`);
  }
}
