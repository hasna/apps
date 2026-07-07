import type {
  CreateTaskRequest,
  DeleteTaskResponse,
  GetTaskResponse,
  ListTasksParams,
  ListTasksResponse,
  MutateTaskResponse,
  Task,
  UpdateTaskRequest,
} from '../types';
import type { TrellistechClient } from './client';

export class TasksApi {
  constructor(private readonly client: TrellistechClient) {}

  private basePath(): string {
    return this.client.workspacePath('/tasks');
  }

  async list(params?: ListTasksParams): Promise<ListTasksResponse> {
    return this.client.get<ListTasksResponse>(this.basePath(), params);
  }

  async get(taskId: string): Promise<Task> {
    const response = await this.client.get<GetTaskResponse>(
      `${this.basePath()}/${encodeURIComponent(taskId)}`
    );
    return response.task;
  }

  async create(body: CreateTaskRequest): Promise<Task> {
    const response = await this.client.post<MutateTaskResponse>(this.basePath(), body);
    return response.task;
  }

  async update(taskId: string, body: UpdateTaskRequest): Promise<Task> {
    const response = await this.client.patch<MutateTaskResponse>(
      `${this.basePath()}/${encodeURIComponent(taskId)}`,
      body
    );
    return response.task;
  }

  async replace(taskId: string, body: UpdateTaskRequest): Promise<Task> {
    const response = await this.client.put<MutateTaskResponse>(
      `${this.basePath()}/${encodeURIComponent(taskId)}`,
      body
    );
    return response.task;
  }

  async delete(taskId: string): Promise<DeleteTaskResponse> {
    return this.client.delete<DeleteTaskResponse>(
      `${this.basePath()}/${encodeURIComponent(taskId)}`
    );
  }
}
