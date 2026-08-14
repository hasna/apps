import type { ConnectorClient } from './client';
import type { AccountLink, AccountLinkCreateParams } from '../types';

/**
 * Stripe Connect Account Links API
 * https://docs.stripe.com/api/account_links
 */
export class AccountLinksApi {
  constructor(private readonly client: ConnectorClient) {}

  async create(params: AccountLinkCreateParams): Promise<AccountLink> {
    return this.client.post<AccountLink>('/account_links', params);
  }
}
