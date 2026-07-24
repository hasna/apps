import type { UnissonClient } from './client';
import { encodePathSegment } from './client';
import type { ListResponse, UnissonTask } from '../types';

export class TasksApi {
  constructor(private readonly client: UnissonClient) {}

  list(params?: Record<string, string | number | boolean | undefined>): Promise<ListResponse<UnissonTask>> {
    return this.client.get<ListResponse<UnissonTask>>('/tasks', params);
  }

  get(taskId: string): Promise<UnissonTask> {
    return this.client.get<UnissonTask>(`/tasks/${encodePathSegment(taskId)}`);
  }

  create(body: Record<string, unknown>): Promise<UnissonTask> {
    return this.client.post<UnissonTask>('/tasks', body);
  }
}
