import type { TrustpilotClient } from './client';
import type { ConsumerReviewsOptions } from '../types';

export class ConsumersApi {
  constructor(private readonly client: TrustpilotClient) {}

  async getProfile(consumerId: string): Promise<unknown> {
    return this.client.get(`/consumers/${encodeURIComponent(consumerId)}/profile`, undefined, 'apikey');
  }

  async getReviews(options: ConsumerReviewsOptions): Promise<unknown> {
    return this.client.get(`/consumers/${encodeURIComponent(options.consumerId)}/reviews`, {
      perPage: options.perPage,
      page: options.page,
      orderBy: options.orderBy,
    }, 'apikey');
  }
}
