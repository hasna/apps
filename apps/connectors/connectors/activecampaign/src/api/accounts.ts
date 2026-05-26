import type { ConnectorClient } from './client';
import type { Account, AccountCreateParams, ListParams } from '../types';

export class AccountsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.limit) queryParams.limit = params.limit;
    if (params?.offset) queryParams.offset = params.offset;
    if (params?.filters) {
      for (const [key, value] of Object.entries(params.filters)) {
        queryParams[key] = value;
      }
    }
    return this.client.get<unknown>('/accounts', queryParams);
  }

  async get(accountId: string): Promise<{ account: Account }> {
    return this.client.get<{ account: Account }>(`/accounts/${accountId}`);
  }

  async create(params: AccountCreateParams): Promise<{ account: Account }> {
    return this.client.post<{ account: Account }>('/accounts', { account: params });
  }

  async update(accountId: string, params: Partial<AccountCreateParams>): Promise<{ account: Account }> {
    return this.client.put<{ account: Account }>(`/accounts/${accountId}`, { account: params });
  }

  async delete(accountId: string): Promise<void> {
    await this.client.delete(`/accounts/${accountId}`);
  }

  async listContacts(accountId: string): Promise<unknown> {
    return this.client.get<unknown>(`/accounts/${accountId}/accountContacts`);
  }

  async addContact(accountId: string, contactId: string): Promise<unknown> {
    return this.client.post<unknown>('/accountContacts', {
      accountContact: { account: accountId, contact: contactId },
    });
  }
}
