import type { ConnectorClient } from './client';
import type { ComputerListResponse } from '../types';

export class ComputersApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * List registered computers
   * GET /api/computer/list
   */
  async list(): Promise<ComputerListResponse> {
    return this.client.get<ComputerListResponse>('/api/computer/list');
  }
}
