import type { ConnectorClient } from './client';
import { V3, toQuery } from './params';
import type {
  ListParams,
  Task,
  TaskResponse,
  TasksResponse,
  CreateTaskParams,
  UpdateTaskParams,
} from '../types';

export class TasksApi {
  constructor(private readonly client: ConnectorClient) {}

  /** List tasks across the whole installation. */
  async list(params?: ListParams): Promise<TasksResponse> {
    return this.client.get<TasksResponse>(`${V3}/tasks.json`, toQuery(params));
  }

  /** List tasks that belong to a specific project. */
  async listByProject(projectId: number | string, params?: ListParams): Promise<TasksResponse> {
    return this.client.get<TasksResponse>(`${V3}/projects/${projectId}/tasks.json`, toQuery(params));
  }

  async get(id: number | string, include?: string): Promise<TaskResponse> {
    return this.client.get<TaskResponse>(`${V3}/tasks/${id}.json`, include ? { include } : undefined);
  }

  /** Create a task inside a tasklist. */
  async create(tasklistId: number | string, data: CreateTaskParams): Promise<TaskResponse> {
    const task: Record<string, unknown> = { name: data.name };
    if (data.description !== undefined) task.description = data.description;
    if (data.priority !== undefined) task.priority = data.priority;
    if (data.startDate !== undefined) task.startDate = data.startDate;
    if (data.dueDate !== undefined) task.dueDate = data.dueDate;
    if (data.progress !== undefined) task.progress = data.progress;
    if (data.assignees !== undefined) task.assignees = data.assignees;
    return this.client.post<TaskResponse>(`${V3}/tasklists/${tasklistId}/tasks.json`, { task });
  }

  async update(id: number | string, data: UpdateTaskParams): Promise<TaskResponse> {
    return this.client.patch<TaskResponse>(`${V3}/tasks/${id}.json`, { task: data });
  }

  async complete(id: number | string): Promise<void> {
    await this.client.put<void>(`${V3}/tasks/${id}/complete.json`);
  }

  async uncomplete(id: number | string): Promise<void> {
    await this.client.put<void>(`${V3}/tasks/${id}/uncomplete.json`);
  }

  async delete(id: number | string): Promise<void> {
    await this.client.delete<void>(`${V3}/tasks/${id}.json`);
  }
}

export type { Task };
