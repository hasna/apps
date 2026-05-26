import type { ConnectorClient } from './client';
import type { Account, ListParams } from '../types';

export class AccountsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<Account[]> {
    return this.client.get<Account[]>('/accounts/', params as Record<string, string | number | boolean | undefined>);
  }

  async get(id: number): Promise<Account> {
    return this.client.get<Account>(`/accounts/${id}/`);
  }
}
