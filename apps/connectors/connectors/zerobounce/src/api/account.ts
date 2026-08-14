import type { ConnectorClient } from './client';
import type { ApiUsageParams, ApiUsageResult, CreditsResult } from '../types';

export class AccountApi {
  constructor(private readonly client: ConnectorClient) {}

  async getCredits(): Promise<CreditsResult> {
    return this.client.get<CreditsResult>('/v2/getcredits');
  }

  async getApiUsage(params: ApiUsageParams): Promise<ApiUsageResult> {
    if (!params.start_date || !params.end_date) {
      throw new Error('start_date and end_date are required');
    }

    return this.client.get<ApiUsageResult>('/v2/getapiusage', {
      start_date: params.start_date,
      end_date: params.end_date,
    });
  }
}
