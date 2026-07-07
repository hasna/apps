import type { ConnectorClient } from './client';
import type { StreakStage } from '../types';

export class StagesApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(pipelineKey: string): Promise<StreakStage[]> {
    return this.client.get<StreakStage[]>(
      `/pipelines/${encodeURIComponent(pipelineKey)}/stages`,
    );
  }

  async create(pipelineKey: string, name: string): Promise<StreakStage> {
    return this.client.putForm<StreakStage>(
      `/pipelines/${encodeURIComponent(pipelineKey)}/stages`,
      { name },
    );
  }
}
