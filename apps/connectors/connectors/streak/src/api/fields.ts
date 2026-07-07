import type { ConnectorClient } from './client';
import type { StreakField, FieldCreateParams } from '../types';

export class FieldsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(pipelineKey: string): Promise<StreakField[]> {
    return this.client.get<StreakField[]>(
      `/pipelines/${encodeURIComponent(pipelineKey)}/fields`,
    );
  }

  async create(pipelineKey: string, data: FieldCreateParams): Promise<StreakField> {
    return this.client.put<StreakField>(
      `/pipelines/${encodeURIComponent(pipelineKey)}/fields`,
      data,
    );
  }
}
