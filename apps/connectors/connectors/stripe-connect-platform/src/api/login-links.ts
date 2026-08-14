import type { ConnectorClient } from './client';
import type { LoginLink } from '../types';

/**
 * Stripe Connect Login Links API
 * https://docs.stripe.com/api/accounts/login_link
 */
export class LoginLinksApi {
  constructor(private readonly client: ConnectorClient) {}

  async create(accountId: string): Promise<LoginLink> {
    return this.client.post<LoginLink>(`/accounts/${accountId}/login_links`, {});
  }
}
