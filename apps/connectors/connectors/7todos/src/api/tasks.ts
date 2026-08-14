import type { ConnectorClient } from './client';
import type { Task, CreateTaskParams } from '../types';

export class TasksApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Create a new task
   */
  async create(params: CreateTaskParams): Promise<Task> {
    const body: Record<string, unknown> = {
      title: params.title,
    };
    if (params.description !== undefined) body.description = params.description;
    if (params.startDate !== undefined) body.startDate = params.startDate;
    if (params.dueDate !== undefined) body.dueDate = params.dueDate;
    if (params.state !== undefined) body.state = params.state;
    if (params.complexity !== undefined) body.complexity = params.complexity;

    return this.client.post<Task>('/tasks/create', body);
  }
}
