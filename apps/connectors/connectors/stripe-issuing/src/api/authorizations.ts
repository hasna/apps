import type { ConnectorClient } from './client';
import type {
  AuthorizationListOptions,
  AuthorizationUpdateParams,
  IssuingAuthorization,
  StripeList,
} from '../types';

/**
 * Stripe Issuing Authorizations API
 * https://stripe.com/docs/api/issuing/authorizations
 */
export class AuthorizationsApi {
  constructor(private readonly client: ConnectorClient) {}

  async get(id: string): Promise<IssuingAuthorization> {
    return this.client.get<IssuingAuthorization>(`/issuing/authorizations/${id}`);
  }

  async update(id: string, params: AuthorizationUpdateParams): Promise<IssuingAuthorization> {
    return this.client.post<IssuingAuthorization>(`/issuing/authorizations/${id}`, params);
  }

  async approve(id: string): Promise<IssuingAuthorization> {
    return this.client.post<IssuingAuthorization>(`/issuing/authorizations/${id}/approve`);
  }

  async decline(id: string): Promise<IssuingAuthorization> {
    return this.client.post<IssuingAuthorization>(`/issuing/authorizations/${id}/decline`);
  }

  async list(options?: AuthorizationListOptions): Promise<StripeList<IssuingAuthorization>> {
    return this.client.get<StripeList<IssuingAuthorization>>(
      '/issuing/authorizations',
      options as Record<string, string | number | boolean | undefined>,
    );
  }
}
