import type { ListUsersOptions } from '../types';
import type { UserpilotClient } from './client';

export class CompaniesApi {
  constructor(private readonly client: UserpilotClient) {}

  delete(companyId: string): Promise<unknown> {
    return this.client.delete(`/companies/${encodeURIComponent(companyId)}`);
  }

  list(options: ListUsersOptions = {}): Promise<unknown> {
    return this.client.get('/companies', options);
  }

  get(companyId: string): Promise<unknown> {
    return this.client.get(`/companies/${encodeURIComponent(companyId)}`);
  }
}
