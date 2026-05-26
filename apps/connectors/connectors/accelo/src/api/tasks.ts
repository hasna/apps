import type { ConnectorClient } from './client';
import type {
  AcceloResponse,
  AcceloListResponse,
  Task,
  CreateTaskParams,
  UpdateTaskParams,
  ListParams,
} from '../types';

export class TasksApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<AcceloListResponse<Task>> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?._page !== undefined) queryParams._page = params._page;
    if (params?._limit !== undefined) queryParams._limit = params._limit;
    if (params?._offset !== undefined) queryParams._offset = params._offset;
    if (params?._fields) queryParams._fields = params._fields;
    if (params?._filters) queryParams._filters = params._filters;
    if (params?._search) queryParams._search = params._search;

    return this.client.get<AcceloListResponse<Task>>('/tasks', queryParams);
  }

  async get(id: string, fields?: string): Promise<AcceloResponse<Task>> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (fields) params._fields = fields;
    return this.client.get<AcceloResponse<Task>>(`/tasks/${id}`, params);
  }

  async create(data: CreateTaskParams): Promise<AcceloResponse<Task>> {
    return this.client.post<AcceloResponse<Task>>('/tasks', data);
  }

  async update(id: string, data: UpdateTaskParams): Promise<AcceloResponse<Task>> {
    return this.client.put<AcceloResponse<Task>>(`/tasks/${id}`, data);
  }

  async count(filters?: string): Promise<AcceloResponse<{ count: number }>> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (filters) params._filters = filters;
    return this.client.get<AcceloResponse<{ count: number }>>('/tasks/count', params);
  }
}
