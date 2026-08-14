import type { ConnectorClient } from './client';
import { V3, toQuery } from './params';
import type {
  ListParams,
  Person,
  PersonResponse,
  PeopleResponse,
} from '../types';

export class PeopleApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<PeopleResponse> {
    return this.client.get<PeopleResponse>(`${V3}/people.json`, toQuery(params));
  }

  /** List people who belong to a project. */
  async listByProject(projectId: number | string, params?: ListParams): Promise<PeopleResponse> {
    return this.client.get<PeopleResponse>(`${V3}/projects/${projectId}/people.json`, toQuery(params));
  }

  async get(id: number | string): Promise<PersonResponse> {
    return this.client.get<PersonResponse>(`${V3}/people/${id}.json`);
  }

  /** Get the currently authenticated user. */
  async me(): Promise<PersonResponse> {
    return this.client.get<PersonResponse>(`${V3}/me.json`);
  }
}

export type { Person };
