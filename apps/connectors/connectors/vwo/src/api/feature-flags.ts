import type { ConnectorClient } from './client';
import type { FeatureFlag, FeatureFlagCreateParams, ListParams } from '../types';

export class FeatureFlagsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams & { status?: string }): Promise<unknown> {
    return this.client.get('/feature-flags', params);
  }

  async get(id: string | number): Promise<FeatureFlag> {
    return this.client.get<FeatureFlag>(`/feature-flags/${encodeURIComponent(String(id))}`);
  }

  async create(data: FeatureFlagCreateParams): Promise<FeatureFlag> {
    return this.client.post<FeatureFlag>('/feature-flags', data);
  }

  async update(id: string | number, data: Record<string, unknown>): Promise<FeatureFlag> {
    return this.client.patch<FeatureFlag>(`/feature-flags/${encodeURIComponent(String(id))}`, data);
  }

  async delete(id: string | number): Promise<unknown> {
    return this.client.delete(`/feature-flags/${encodeURIComponent(String(id))}`);
  }

  async toggle(id: string | number, environmentKey: string, enabled: boolean): Promise<unknown> {
    return this.client.patch(
      `/feature-flags/${encodeURIComponent(String(id))}/environments/${encodeURIComponent(environmentKey)}`,
      { enabled },
    );
  }
}
