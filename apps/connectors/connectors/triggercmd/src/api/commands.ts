import type { ConnectorClient } from './client';
import type { CommandListParams, CommandListResponse } from '../types';

export class CommandsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * List all commands across all computers
   * POST /api/command/commandlist
   */
  async commandlist(): Promise<CommandListResponse> {
    return this.client.post<CommandListResponse>('/api/command/commandlist');
  }

  /**
   * List commands for a specific computer
   * POST /api/command/list
   */
  async list(params?: CommandListParams): Promise<CommandListResponse> {
    const body: Record<string, unknown> = {};
    if (params?.computer_id) {
      body.computer_id = params.computer_id;
    }
    return this.client.post<CommandListResponse>('/api/command/list', body);
  }
}
