import type { ConnectorClient } from './client';
import type {
  CardCreateParams,
  CardListOptions,
  CardUpdateParams,
  IssuingCard,
  StripeList,
  StripeSearchResult,
} from '../types';

/**
 * Stripe Issuing Cards API
 * https://stripe.com/docs/api/issuing/cards
 */
export class CardsApi {
  constructor(private readonly client: ConnectorClient) {}

  async create(params: CardCreateParams): Promise<IssuingCard> {
    return this.client.post<IssuingCard>('/issuing/cards', params);
  }

  async get(id: string): Promise<IssuingCard> {
    return this.client.get<IssuingCard>(`/issuing/cards/${id}`);
  }

  async update(id: string, params: CardUpdateParams): Promise<IssuingCard> {
    return this.client.post<IssuingCard>(`/issuing/cards/${id}`, params);
  }

  async list(options?: CardListOptions): Promise<StripeList<IssuingCard>> {
    return this.client.get<StripeList<IssuingCard>>(
      '/issuing/cards',
      options as Record<string, string | number | boolean | undefined>,
    );
  }

  async search(query: string, options?: { limit?: number; page?: string }): Promise<StripeSearchResult<IssuingCard>> {
    return this.client.get<StripeSearchResult<IssuingCard>>('/issuing/cards/search', {
      query,
      limit: options?.limit,
      page: options?.page,
    });
  }
}
