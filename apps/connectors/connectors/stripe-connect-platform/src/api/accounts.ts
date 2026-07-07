import type { ConnectorClient } from './client';
import type {
  Account,
  AccountCreateParams,
  AccountListOptions,
  AccountUpdateParams,
  DeletedObject,
  StripeList,
} from '../types';

/**
 * Stripe Connect Accounts API
 * https://docs.stripe.com/api/accounts
 */
export class AccountsApi {
  constructor(private readonly client: ConnectorClient) {}

  async create(params: AccountCreateParams): Promise<Account> {
    return this.client.post<Account>('/accounts', params);
  }

  async get(id: string): Promise<Account> {
    return this.client.get<Account>(`/accounts/${id}`);
  }

  async update(id: string, params: AccountUpdateParams): Promise<Account> {
    return this.client.post<Account>(`/accounts/${id}`, params);
  }

  async list(options?: AccountListOptions): Promise<StripeList<Account>> {
    return this.client.get<StripeList<Account>>(
      '/accounts',
      options as Record<string, string | number | boolean | undefined>,
    );
  }

  async del(id: string): Promise<DeletedObject> {
    return this.client.delete<DeletedObject>(`/accounts/${id}`);
  }
}
