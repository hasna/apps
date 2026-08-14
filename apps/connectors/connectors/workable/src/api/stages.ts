import type { ConnectorClient } from './client';
import type { Stage, WorkableListResponse } from '../types';

export class StagesApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(): Promise<WorkableListResponse<Stage>> {
    return this.client.get<WorkableListResponse<Stage>>('/stages');
  }
}
