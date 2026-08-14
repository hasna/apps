import type { StatsigClient } from './client';
import type { JsonRecord } from '../types';

function encodeId(id: string): string {
  return encodeURIComponent(id);
}

/** @see https://docs.statsig.com/console-api/experiments */
export class ExperimentsApi {
  constructor(private readonly client: StatsigClient) {}

  list(): Promise<unknown> {
    return this.client.get('/experiments');
  }

  get(id: string): Promise<unknown> {
    return this.client.get(`/experiments/${encodeId(id)}`);
  }

  create(body: JsonRecord): Promise<unknown> {
    return this.client.post('/experiments', body);
  }

  update(id: string, patch: JsonRecord, mode: 'PUT' | 'PATCH' = 'PATCH'): Promise<unknown> {
    const path = `/experiments/${encodeId(id)}`;
    return mode === 'PUT' ? this.client.put(path, patch) : this.client.patch(path, patch);
  }

  delete(id: string): Promise<unknown> {
    return this.client.delete(`/experiments/${encodeId(id)}`);
  }

  start(id: string): Promise<unknown> {
    return this.client.post(`/experiments/${encodeId(id)}/start`);
  }

  finish(id: string, body?: JsonRecord): Promise<unknown> {
    return this.client.post(`/experiments/${encodeId(id)}/finish`, body);
  }

  reset(id: string): Promise<unknown> {
    return this.client.post(`/experiments/${encodeId(id)}/reset`);
  }
}
