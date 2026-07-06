import type { TheHiveProjectClient } from './client';
import type { CaseCreateBody, ListQueryParams } from '../types';

export class CasesApi {
  constructor(private readonly client: TheHiveProjectClient) {}

  async list(params?: ListQueryParams): Promise<unknown> {
    return this.client.get<unknown>('/cases', params);
  }

  async create(body: CaseCreateBody): Promise<unknown> {
    return this.client.post<unknown>('/cases', body);
  }

  async get(caseId: string): Promise<unknown> {
    const encoded = encodeURIComponent(caseId);
    return this.client.get<unknown>(`/cases/${encoded}`);
  }
}
