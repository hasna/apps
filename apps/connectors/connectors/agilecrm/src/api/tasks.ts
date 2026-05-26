import type { ConnectorClient } from './client';
import type {
  Task,
  TaskCreateParams,
  TaskUpdateParams,
} from '../types';

export class TasksApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(): Promise<Task[]> {
    return this.client.get<Task[]>('/tasks');
  }

  async get(id: number): Promise<Task> {
    return this.client.get<Task>(`/tasks/${id}`);
  }

  async create(data: TaskCreateParams): Promise<Task> {
    return this.client.post<Task>('/tasks', data);
  }

  async update(data: TaskUpdateParams): Promise<Task> {
    return this.client.put<Task>('/tasks/partial-update', data);
  }

  async delete(id: number): Promise<void> {
    await this.client.delete(`/tasks/${id}`);
  }

  async getPending(numDays: number): Promise<Task[]> {
    return this.client.get<Task[]>(`/tasks/pending/${numDays}`);
  }

  async getByContact(contactId: number): Promise<Task[]> {
    return this.client.get<Task[]>(`/contacts/${contactId}/tasks/sort`);
  }
}
