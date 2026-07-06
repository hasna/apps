import type { ConnectorClient } from './client';
import type { CreateTaskParams, ListParams, TaskListResponse, TaskResponse } from '../types';

export class TasksApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<TaskListResponse> {
    return this.client.get<TaskListResponse>('/tasks', params as Record<string, string | number>);
  }

  async get(id: string): Promise<TaskResponse> {
    return this.client.get<TaskResponse>(`/tasks/${encodeURIComponent(id)}`);
  }

  async create(body: CreateTaskParams): Promise<TaskResponse> {
    const payload = { ...body };
    if (payload.agentId && !payload.agent_id) {
      payload.agent_id = payload.agentId;
      delete payload.agentId;
    }
    return this.client.post<TaskResponse>('/tasks', payload);
  }

  async cancel(id: string, body?: Record<string, unknown>): Promise<TaskResponse> {
    return this.client.post<TaskResponse>(`/tasks/${encodeURIComponent(id)}/cancel`, body);
  }
}
