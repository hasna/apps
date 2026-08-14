import type { GoDaddyConfig } from '../types';
import { GoDaddyClient } from './client';
import { DomainsApi } from './domains';
import { DnsApi } from './dns';
import {
  getApiKey,
  getApiSecret,
} from '../utils/config';

export class GoDaddy {
  private readonly client: GoDaddyClient;

  // API modules
  public readonly domains: DomainsApi;
  public readonly dns: DnsApi;

  constructor(config: GoDaddyConfig) {
    this.client = new GoDaddyClient(config);
    this.domains = new DomainsApi(this.client);
    this.dns = new DnsApi(this.client);
  }

  /**
   * Create a GoDaddy client from config file or environment variables
   * Priority: env vars > config file
   */
  static create(): GoDaddy {
    const apiKey = getApiKey();
    const apiSecret = getApiSecret();

    if (!apiKey || !apiSecret) {
      throw new Error(
        'GoDaddy credentials not configured. ' +
        'Set GODADDY_API_KEY and GODADDY_API_SECRET environment variables, ' +
        'or run "connect-godaddy config set-credentials <key> <secret>"'
      );
    }

    return new GoDaddy({ apiKey, apiSecret });
  }

  /**
   * Create a GoDaddy client from environment variables only
   */
  static fromEnv(): GoDaddy {
    const apiKey = process.env.GODADDY_API_KEY;
    const apiSecret = process.env.GODADDY_API_SECRET;

    if (!apiKey || !apiSecret) {
      throw new Error(
        'GODADDY_API_KEY and GODADDY_API_SECRET environment variables are required'
      );
    }

    return new GoDaddy({ apiKey, apiSecret });
  }

  /**
   * Get a preview of the credentials (for debugging)
   */
  getCredentialPreview(): string {
    return this.client.getCredentialPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): GoDaddyClient {
    return this.client;
  }
}

// Export the client and all API modules
export { GoDaddyClient } from './client';
export { DomainsApi } from './domains';
export { DnsApi } from './dns';
