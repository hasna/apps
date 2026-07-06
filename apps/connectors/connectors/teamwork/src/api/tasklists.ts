import type { ConnectorClient } from './client';
import { V3, toQuery } from './params';
import type {
  ListParams,
  Tasklist,
  TasklistResponse,
  TasklistsResponse,
  CreateTasklistParams,
} from '../types';

export class TasklistsApi {
  constructor(private readonly client: ConnectorClient) {}

  /** List task lists that belong to a project. */
  async listByProject(projectId: number | string, params?: ListParams): Promise<TasklistsResponse> {
    return this.client.get<TasklistsResponse>(`${V3}/projects/${projectId}/tasklists.json`, toQuery(params));
  }

  async get(id: number | string): Promise<TasklistResponse> {
    return this.client.get<TasklistResponse>(`${V3}/tasklists/${id}.json`);
  }

  /** Create a task list in a project. */
  async create(projectId: number | string, data: CreateTasklistParams): Promise<TasklistResponse> {
    const tasklist: Record<string, unknown> = { name: data.name };
    if (data.description !== undefined) tasklist.description = data.description;
    if (data.milestoneId !== undefined) tasklist.milestoneId = data.milestoneId;
    return this.client.post<TasklistResponse>(`${V3}/projects/${projectId}/tasklists.json`, { tasklist });
  }

  async delete(id: number | string): Promise<void> {
    await this.client.delete<void>(`${V3}/tasklists/${id}.json`);
  }
}

export type { Tasklist };
