import type { SmileClient } from './client';
import type { ListEarningRulesOptions, ListEarningRulesResponse } from '../types';

/**
 * Earning Rules API — the ways customers earn points.
 * Endpoint: GET /earning_rules
 */
export class EarningRulesApi {
  constructor(private readonly client: SmileClient) {}

  /** List earning rules with cursor pagination. */
  async list(options: ListEarningRulesOptions = {}): Promise<ListEarningRulesResponse> {
    return this.client.request<ListEarningRulesResponse>('/earning_rules', {
      params: { limit: options.limit, cursor: options.cursor },
    });
  }
}
