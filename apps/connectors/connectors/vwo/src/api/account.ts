import type { ConnectorClient } from './client';
import type { Account } from '../types';

export class AccountApi {
  constructor(private readonly client: ConnectorClient) {}

  async me(): Promise<Account> {
    return this.client.get<Account>('/accounts/me');
  }
}
