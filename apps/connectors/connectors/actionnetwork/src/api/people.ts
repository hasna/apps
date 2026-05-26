import type { ConnectorClient } from './client';
import type { Person, PersonSignupParams, PersonUpdateParams, ListParams } from '../types';

export class PeopleApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.page) queryParams.page = params.page;
    if (params?.per_page) queryParams.per_page = params.per_page;
    if (params?.filter) queryParams.filter = params.filter;
    return this.client.get<unknown>('/people', queryParams);
  }

  async get(personId: string): Promise<Person> {
    return this.client.get<Person>(`/people/${personId}`);
  }

  async signup(params: PersonSignupParams): Promise<Person> {
    return this.client.post<Person>('/people', params);
  }

  async update(personId: string, params: PersonUpdateParams): Promise<Person> {
    return this.client.put<Person>(`/people/${personId}`, params);
  }
}
