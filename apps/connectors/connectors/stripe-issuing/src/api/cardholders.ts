import type { ConnectorClient } from './client';
import type {
  Cardholder,
  CardholderCreateParams,
  CardholderListOptions,
  CardholderUpdateParams,
  StripeList,
} from '../types';

/**
 * Stripe Issuing Cardholders API
 * https://stripe.com/docs/api/issuing/cardholders
 */
export class CardholdersApi {
  constructor(private readonly client: ConnectorClient) {}

  async create(params: CardholderCreateParams): Promise<Cardholder> {
    return this.client.post<Cardholder>('/issuing/cardholders', params);
  }

  async get(id: string): Promise<Cardholder> {
    return this.client.get<Cardholder>(`/issuing/cardholders/${id}`);
  }

  async update(id: string, params: CardholderUpdateParams): Promise<Cardholder> {
    return this.client.post<Cardholder>(`/issuing/cardholders/${id}`, params);
  }

  async list(options?: CardholderListOptions): Promise<StripeList<Cardholder>> {
    return this.client.get<StripeList<Cardholder>>(
      '/issuing/cardholders',
      options as Record<string, string | number | boolean | undefined>,
    );
  }
}
