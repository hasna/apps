import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { DomainsApi } from './domains';
import { DnsApi } from './dns';

/**
 * Namecheap API Connector class
 */
export class Connector {
  private readonly client: ConnectorClient;

  // API modules
  public readonly domains: DomainsApi;
  public readonly dns: DnsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.domains = new DomainsApi(this.client);
    this.dns = new DnsApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for NAMECHEAP_API_KEY, NAMECHEAP_USERNAME, NAMECHEAP_CLIENT_IP
   */
  static fromEnv(): Connector {
    const apiKey = process.env.NAMECHEAP_API_KEY;
    const username = process.env.NAMECHEAP_USERNAME;
    const clientIp = process.env.NAMECHEAP_CLIENT_IP;

    if (!apiKey) {
      throw new Error('NAMECHEAP_API_KEY environment variable is required');
    }
    if (!username) {
      throw new Error('NAMECHEAP_USERNAME environment variable is required');
    }
    if (!clientIp) {
      throw new Error('NAMECHEAP_CLIENT_IP environment variable is required');
    }

    return new Connector({
      apiKey,
      username,
      clientIp,
      sandbox: process.env.NAMECHEAP_SANDBOX === 'true',
    });
  }

  /**
   * Get a preview of the API key (for debugging)
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): ConnectorClient {
    return this.client;
  }
}

// Export client and all API classes
export { ConnectorClient } from './client';
export { DomainsApi } from './domains';
export { DnsApi } from './dns';
