import type { ConnectorClient } from './client';
import type {
  AcceloResponse,
  AcceloListResponse,
  Job,
  CreateJobParams,
  UpdateJobParams,
  ListParams,
} from '../types';

export class JobsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<AcceloListResponse<Job>> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?._page !== undefined) queryParams._page = params._page;
    if (params?._limit !== undefined) queryParams._limit = params._limit;
    if (params?._offset !== undefined) queryParams._offset = params._offset;
    if (params?._fields) queryParams._fields = params._fields;
    if (params?._filters) queryParams._filters = params._filters;
    if (params?._search) queryParams._search = params._search;

    return this.client.get<AcceloListResponse<Job>>('/jobs', queryParams);
  }

  async get(id: string, fields?: string): Promise<AcceloResponse<Job>> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (fields) params._fields = fields;
    return this.client.get<AcceloResponse<Job>>(`/jobs/${id}`, params);
  }

  async create(data: CreateJobParams): Promise<AcceloResponse<Job>> {
    return this.client.post<AcceloResponse<Job>>('/jobs', data);
  }

  async update(id: string, data: UpdateJobParams): Promise<AcceloResponse<Job>> {
    return this.client.put<AcceloResponse<Job>>(`/jobs/${id}`, data);
  }

  async count(filters?: string): Promise<AcceloResponse<{ count: number }>> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (filters) params._filters = filters;
    return this.client.get<AcceloResponse<{ count: number }>>('/jobs/count', params);
  }
}
