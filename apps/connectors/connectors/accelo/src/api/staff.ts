import type { ConnectorClient } from './client';
import type {
  AcceloResponse,
  AcceloListResponse,
  Staff,
  ListParams,
} from '../types';

export class StaffApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<AcceloListResponse<Staff>> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?._page !== undefined) queryParams._page = params._page;
    if (params?._limit !== undefined) queryParams._limit = params._limit;
    if (params?._offset !== undefined) queryParams._offset = params._offset;
    if (params?._fields) queryParams._fields = params._fields;
    if (params?._filters) queryParams._filters = params._filters;
    if (params?._search) queryParams._search = params._search;

    return this.client.get<AcceloListResponse<Staff>>('/staff', queryParams);
  }

  async get(id: string, fields?: string): Promise<AcceloResponse<Staff>> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (fields) params._fields = fields;
    return this.client.get<AcceloResponse<Staff>>(`/staff/${id}`, params);
  }

  async me(): Promise<AcceloResponse<Staff>> {
    return this.client.get<AcceloResponse<Staff>>('/user');
  }
}
