import type { ConnectorClient } from './client';
import type { Account, CollectionResponse } from '../types';

/**
 * Account configuration endpoints.
 * Docs: https://developers.taboola.com/backstage-api/reference/account-configuration
 */
export class AccountApi {
  constructor(private readonly client: ConnectorClient) {}

  /** List the accounts the authenticated user is allowed to operate on. */
  async listAllowed(): Promise<CollectionResponse<Account>> {
    return this.client.get<CollectionResponse<Account>>('/users/current/allowed-accounts');
  }

  /** Get details of the account backing the current credentials. */
  async getCurrent(): Promise<Account> {
    return this.client.get<Account>('/users/current/account');
  }
}
