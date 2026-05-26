import type { GoDaddyClient } from './client';
import type { GoDaddyDomain, GoDaddyDomainDetail, GoDaddyAvailability, GoDaddyRenewResponse } from '../types';

export class DomainsApi {
  constructor(private readonly client: GoDaddyClient) {}

  /**
   * List all domains in the GoDaddy account
   */
  async list(params?: {
    limit?: number;
    marker?: string;
    statuses?: string[];
  }): Promise<GoDaddyDomain[]> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.limit) queryParams.limit = params.limit;
    if (params?.marker) queryParams.marker = params.marker;
    if (params?.statuses) queryParams.statuses = params.statuses.join(',');

    return this.client.get<GoDaddyDomain[]>('/v1/domains', queryParams);
  }

  /**
   * Get detailed info for a single domain
   */
  async getInfo(domain: string): Promise<GoDaddyDomainDetail> {
    return this.client.get<GoDaddyDomainDetail>(
      `/v1/domains/${encodeURIComponent(domain)}`
    );
  }

  /**
   * Renew a domain for a specified number of years (default: 1)
   */
  async renew(domain: string, period: number = 1): Promise<GoDaddyRenewResponse> {
    return this.client.post<GoDaddyRenewResponse>(
      `/v1/domains/${encodeURIComponent(domain)}/renew`,
      { period }
    );
  }

  /**
   * Check domain availability for purchase
   */
  async checkAvailability(domain: string): Promise<GoDaddyAvailability> {
    return this.client.get<GoDaddyAvailability>(
      '/v1/domains/available',
      { domain }
    );
  }
}
