import type { ConnectorClient } from './client';
import type { BlacklistParams, BlacklistEntry } from '../types';

export class BlacklistApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Get the AbuseIPDB blacklist of most-reported abusive IP addresses.
   */
  async get(params?: BlacklistParams): Promise<BlacklistEntry[]> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};

    if (params?.confidenceMinimum !== undefined) {
      queryParams.confidenceMinimum = params.confidenceMinimum;
    }
    if (params?.limit !== undefined) {
      queryParams.limit = params.limit;
    }
    if (params?.onlyCountries) {
      queryParams.onlyCountries = params.onlyCountries;
    }
    if (params?.exceptCountries) {
      queryParams.exceptCountries = params.exceptCountries;
    }
    if (params?.ipVersion !== undefined) {
      queryParams.ipVersion = params.ipVersion;
    }

    const response = await this.client.get<{ data: BlacklistEntry[] }>('/blacklist', queryParams);
    return response.data;
  }
}
