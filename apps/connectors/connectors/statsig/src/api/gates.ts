import type { StatsigClient } from './client';
import type { JsonRecord } from '../types';

function encodeId(id: string): string {
  return encodeURIComponent(id);
}

/** @see https://docs.statsig.com/console-api/gates */
export class GatesApi {
  constructor(private readonly client: StatsigClient) {}

  list(): Promise<unknown> {
    return this.client.get('/gates');
  }

  get(id: string): Promise<unknown> {
    return this.client.get(`/gates/${encodeId(id)}`);
  }

  create(body: JsonRecord): Promise<unknown> {
    return this.client.post('/gates', body);
  }

  update(id: string, patch: JsonRecord, mode: 'PUT' | 'PATCH' = 'PATCH'): Promise<unknown> {
    const path = `/gates/${encodeId(id)}`;
    return mode === 'PUT' ? this.client.put(path, patch) : this.client.patch(path, patch);
  }

  delete(id: string): Promise<unknown> {
    return this.client.delete(`/gates/${encodeId(id)}`);
  }

  enable(id: string): Promise<unknown> {
    return this.client.post(`/gates/${encodeId(id)}/enable`);
  }

  disable(id: string): Promise<unknown> {
    return this.client.post(`/gates/${encodeId(id)}/disable`);
  }

  archive(id: string): Promise<unknown> {
    return this.client.post(`/gates/${encodeId(id)}/archive`);
  }

  launch(id: string): Promise<unknown> {
    return this.client.post(`/gates/${encodeId(id)}/launch`);
  }

  listRules(id: string): Promise<unknown> {
    return this.client.get(`/gates/${encodeId(id)}/rules`);
  }

  addRule(id: string, rule: JsonRecord): Promise<unknown> {
    return this.client.post(`/gates/${encodeId(id)}/rules`, rule);
  }

  deleteRule(id: string, ruleId: string): Promise<unknown> {
    return this.client.delete(`/gates/${encodeId(id)}/rules/${encodeId(ruleId)}`);
  }

  getOverrides(id: string): Promise<unknown> {
    return this.client.get(`/gates/${encodeId(id)}/overrides`);
  }

  updateOverrides(id: string, overrides: JsonRecord): Promise<unknown> {
    return this.client.post(`/gates/${encodeId(id)}/overrides`, overrides);
  }
}
