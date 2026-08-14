import type { ConnectorClient } from './client';
import type { ConnectionToken, ConnectionTokenCreateParams } from '../types';

/**
 * Stripe Terminal Connection Tokens API
 * https://stripe.com/docs/api/terminal/connection_tokens
 */
export class ConnectionTokensApi {
  constructor(private readonly client: ConnectorClient) {}

  async create(params?: ConnectionTokenCreateParams): Promise<ConnectionToken> {
    return this.client.post<ConnectionToken>('/terminal/connection_tokens', params ?? {});
  }
}
