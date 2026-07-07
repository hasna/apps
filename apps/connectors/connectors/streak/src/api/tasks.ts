import type { ConnectorClient } from './client';
import type { StreakTask, TaskCreateParams, TaskUpdateParams } from '../types';

export class TasksApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(boxKey: string): Promise<StreakTask[]> {
    return this.client.get<StreakTask[]>(`/boxes/${encodeURIComponent(boxKey)}/tasks`);
  }

  async create(boxKey: string, data: TaskCreateParams): Promise<StreakTask> {
    return this.client.put<StreakTask>(
      `/boxes/${encodeURIComponent(boxKey)}/tasks`,
      data,
    );
  }

  async update(key: string, data: TaskUpdateParams): Promise<StreakTask> {
    return this.client.post<StreakTask>(`/tasks/${encodeURIComponent(key)}`, data);
  }

  async delete(key: string): Promise<void> {
    await this.client.delete(`/tasks/${encodeURIComponent(key)}`);
  }
}
