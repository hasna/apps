import type { ConnectorClient } from './client';
import type { RunListParams, RunListResponse } from '../types';

export class RunsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * List command run history
   * GET /api/run/list
   */
  async list(params?: RunListParams): Promise<RunListResponse> {
    const queryParams: Record<string, string | undefined> = {};
    if (params?.sortOn) queryParams.sortOn = params.sortOn;
    if (params?.command_id) queryParams.command_id = params.command_id;

    return this.client.get<RunListResponse>('/api/run/list', queryParams);
  }
}
