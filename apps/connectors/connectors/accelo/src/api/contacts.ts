import type { ConnectorClient } from './client';
import type {
  AcceloResponse,
  AcceloListResponse,
  Contact,
  CreateContactParams,
  UpdateContactParams,
  ListParams,
} from '../types';

export class ContactsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<AcceloListResponse<Contact>> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?._page !== undefined) queryParams._page = params._page;
    if (params?._limit !== undefined) queryParams._limit = params._limit;
    if (params?._offset !== undefined) queryParams._offset = params._offset;
    if (params?._fields) queryParams._fields = params._fields;
    if (params?._filters) queryParams._filters = params._filters;
    if (params?._search) queryParams._search = params._search;

    return this.client.get<AcceloListResponse<Contact>>('/contacts', queryParams);
  }

  async get(id: string, fields?: string): Promise<AcceloResponse<Contact>> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (fields) params._fields = fields;
    return this.client.get<AcceloResponse<Contact>>(`/contacts/${id}`, params);
  }

  async create(data: CreateContactParams): Promise<AcceloResponse<Contact>> {
    return this.client.post<AcceloResponse<Contact>>('/contacts', data);
  }

  async update(id: string, data: UpdateContactParams): Promise<AcceloResponse<Contact>> {
    return this.client.put<AcceloResponse<Contact>>(`/contacts/${id}`, data);
  }

  async count(filters?: string): Promise<AcceloResponse<{ count: number }>> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (filters) params._filters = filters;
    return this.client.get<AcceloResponse<{ count: number }>>('/contacts/count', params);
  }
}
