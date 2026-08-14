import { SedoClient } from './client';
import { DomainsApi } from './domains';
import type { SedoConfig } from '../types';

export class Sedo {
  private readonly client: SedoClient;
  public readonly domains: DomainsApi;

  constructor(config: SedoConfig) {
    this.client = new SedoClient(config);
    this.domains = new DomainsApi(this.client);
  }

  /**
   * Get partner ID for display purposes
   */
  getPartnerId(): string {
    return this.client.getPartnerId();
  }

  /**
   * Check if account credentials are configured
   */
  hasCredentials(): boolean {
    return this.client.hasCredentials();
  }
}

export { SedoClient } from './client';
export { DomainsApi } from './domains';
