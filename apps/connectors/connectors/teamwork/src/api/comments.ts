import type { ConnectorClient } from './client';
import { V3, toQuery } from './params';
import type { ListParams, CommentsResponse } from '../types';

export class CommentsApi {
  constructor(private readonly client: ConnectorClient) {}

  /** List comments across the installation. */
  async list(params?: ListParams): Promise<CommentsResponse> {
    return this.client.get<CommentsResponse>(`${V3}/comments.json`, toQuery(params));
  }

  /** List comments attached to a specific task. */
  async listByTask(taskId: number | string, params?: ListParams): Promise<CommentsResponse> {
    return this.client.get<CommentsResponse>(`${V3}/tasks/${taskId}/comments.json`, toQuery(params));
  }
}
