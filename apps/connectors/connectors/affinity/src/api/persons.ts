import type { ConnectorClient } from './client';
import type { Person, PersonCreateParams, ListParams, PaginatedResponse } from '../types';

export class PersonsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<PaginatedResponse<Person>> {
    return this.client.get<PaginatedResponse<Person>>('/v2/persons', params as Record<string, string | number | boolean | undefined>);
  }

  async get(id: number, fieldIds?: number[]): Promise<Person> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (fieldIds?.length) {
      params.fieldIds = fieldIds.join(',');
    }
    return this.client.get<Person>(`/v2/persons/${id}`, params);
  }

  async create(data: PersonCreateParams): Promise<Person> {
    return this.client.post<Person>('/v2/persons', data);
  }

  async update(id: number, data: Partial<PersonCreateParams>): Promise<Person> {
    return this.client.patch<Person>(`/v2/persons/${id}`, data);
  }

  async delete(id: number): Promise<void> {
    await this.client.delete(`/v2/persons/${id}`);
  }
}
