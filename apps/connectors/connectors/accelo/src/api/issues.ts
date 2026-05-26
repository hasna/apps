import type { ConnectorClient } from './client';
import type {
  AcceloResponse,
  AcceloListResponse,
  Issue,
  CreateIssueParams,
  UpdateIssueParams,
  ListParams,
} from '../types';

export class IssuesApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<AcceloListResponse<Issue>> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?._page !== undefined) queryParams._page = params._page;
    if (params?._limit !== undefined) queryParams._limit = params._limit;
    if (params?._offset !== undefined) queryParams._offset = params._offset;
    if (params?._fields) queryParams._fields = params._fields;
    if (params?._filters) queryParams._filters = params._filters;
    if (params?._search) queryParams._search = params._search;

    return this.client.get<AcceloListResponse<Issue>>('/issues', queryParams);
  }

  async get(id: string, fields?: string): Promise<AcceloResponse<Issue>> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (fields) params._fields = fields;
    return this.client.get<AcceloResponse<Issue>>(`/issues/${id}`, params);
  }

  async create(data: CreateIssueParams): Promise<AcceloResponse<Issue>> {
    return this.client.post<AcceloResponse<Issue>>('/issues', data);
  }

  async update(id: string, data: UpdateIssueParams): Promise<AcceloResponse<Issue>> {
    return this.client.put<AcceloResponse<Issue>>(`/issues/${id}`, data);
  }

  async count(filters?: string): Promise<AcceloResponse<{ count: number }>> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (filters) params._filters = filters;
    return this.client.get<AcceloResponse<{ count: number }>>('/issues/count', params);
  }
}
