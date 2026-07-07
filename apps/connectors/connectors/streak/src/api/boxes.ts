import type { ConnectorClient } from './client';
import type { StreakBox, BoxCreateParams, BoxUpdateParams, BoxListParams } from '../types';

export class BoxesApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(pipelineKey?: string, params?: BoxListParams): Promise<StreakBox[]> {
    const query = params as Record<string, string | number | boolean | undefined> | undefined;
    if (pipelineKey) {
      return this.client.get<StreakBox[]>(
        `/pipelines/${encodeURIComponent(pipelineKey)}/boxes`,
        query,
      );
    }
    return this.client.get<StreakBox[]>('/boxes', query);
  }

  async get(key: string): Promise<StreakBox> {
    return this.client.get<StreakBox>(`/boxes/${encodeURIComponent(key)}`);
  }

  async create(pipelineKey: string, data: BoxCreateParams): Promise<StreakBox> {
    return this.client.postV2<StreakBox>(
      `/pipelines/${encodeURIComponent(pipelineKey)}/boxes`,
      data,
    );
  }

  async update(key: string, data: BoxUpdateParams): Promise<StreakBox> {
    return this.client.post<StreakBox>(`/boxes/${encodeURIComponent(key)}`, data);
  }

  async delete(key: string): Promise<void> {
    await this.client.delete(`/boxes/${encodeURIComponent(key)}`);
  }
}
