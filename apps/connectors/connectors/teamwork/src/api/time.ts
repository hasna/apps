import type { ConnectorClient } from './client';
import { V3, toQuery } from './params';
import type { ListParams, TimeEntriesResponse } from '../types';

export class TimeApi {
  constructor(private readonly client: ConnectorClient) {}

  /** List time entries (timelogs) across the installation. */
  async list(params?: ListParams): Promise<TimeEntriesResponse> {
    return this.client.get<TimeEntriesResponse>(`${V3}/time.json`, toQuery(params));
  }

  /** List time entries logged against a specific project. */
  async listByProject(projectId: number | string, params?: ListParams): Promise<TimeEntriesResponse> {
    return this.client.get<TimeEntriesResponse>(`${V3}/projects/${projectId}/time.json`, toQuery(params));
  }

  /** List time entries logged against a specific task. */
  async listByTask(taskId: number | string, params?: ListParams): Promise<TimeEntriesResponse> {
    return this.client.get<TimeEntriesResponse>(`${V3}/tasks/${taskId}/time.json`, toQuery(params));
  }
}
