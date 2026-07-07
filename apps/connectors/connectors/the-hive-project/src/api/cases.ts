import type { TheHiveProjectClient } from './client';
import type { CaseCreateBody, CaseQueryBody } from '../types';

const DEFAULT_CASE_QUERY: CaseQueryBody = {
  query: [{ _name: 'listCase' }],
};

export class CasesApi {
  constructor(private readonly client: TheHiveProjectClient) {}

  async list(body: CaseQueryBody = DEFAULT_CASE_QUERY): Promise<unknown> {
    return this.client.post<unknown>('/query', body);
  }

  async create(body: CaseCreateBody): Promise<unknown> {
    return this.client.post<unknown>('/case', body);
  }

  async get(idOrName: string): Promise<unknown> {
    const encoded = encodeURIComponent(idOrName);
    return this.client.get<unknown>(`/case/${encoded}`);
  }
}
