import type { ContactOutClient } from './client';
import type { StatsParams, StatsResponse } from '../types';

/**
 * Stats API - Get API usage statistics
 */
export class StatsApi {
  constructor(private readonly client: ContactOutClient) {}

  /**
   * Get API usage statistics
   * @param params.period - Optional period in YYYY-MM format
   * @returns Usage breakdown for email, phone, search, and verifier credits
   */
  async get(params?: StatsParams): Promise<StatsResponse> {
    return this.client.get<StatsResponse>('/v1/stats', {
      period: params?.period,
    });
  }

  /**
   * Get current month's usage (convenience method)
   * @returns Current month's usage statistics
   */
  async getCurrentMonth(): Promise<StatsResponse> {
    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return this.get({ period });
  }
}
