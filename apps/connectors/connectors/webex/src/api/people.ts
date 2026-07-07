import type { WebexClient } from './client';
import type {
  PaginatedResponse,
  WebexPerson,
  WebexPersonCreateRequest,
  WebexPersonUpdateRequest,
  ListPeopleOptions,
} from '../types';

export class PeopleApi {
  constructor(private readonly client: WebexClient) {}

  async list(options: ListPeopleOptions = {}): Promise<WebexPerson[]> {
    const response = await this.client.get<PaginatedResponse<WebexPerson>>('/people', {
      email: options.email,
      displayName: options.displayName,
      id: options.id,
      orgId: options.orgId,
      max: options.max,
    });
    return response.items ?? [];
  }

  async me(): Promise<WebexPerson> {
    return this.client.get<WebexPerson>('/people/me');
  }

  async get(personId: string): Promise<WebexPerson> {
    return this.client.get<WebexPerson>(`/people/${encodeURIComponent(personId)}`);
  }

  async create(person: WebexPersonCreateRequest): Promise<WebexPerson> {
    return this.client.post<WebexPerson>('/people', person);
  }

  async update(personId: string, updates: WebexPersonUpdateRequest): Promise<WebexPerson> {
    return this.client.put<WebexPerson>(`/people/${encodeURIComponent(personId)}`, updates);
  }

  async delete(personId: string): Promise<void> {
    await this.client.delete(`/people/${encodeURIComponent(personId)}`);
  }
}
