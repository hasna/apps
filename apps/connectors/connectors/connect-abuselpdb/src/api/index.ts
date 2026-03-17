import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { CheckApi } from './check';
import { ReportApi } from './report';
import { BlacklistApi } from './blacklist';

/**
 * AbuseIPDB Connector
 * Provides access to IP abuse checking, reporting, and blacklist APIs.
 */
export class Connector {
  private readonly client: ConnectorClient;

  public readonly check: CheckApi;
  public readonly report: ReportApi;
  public readonly blacklist: BlacklistApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.check = new CheckApi(this.client);
    this.report = new ReportApi(this.client);
    this.blacklist = new BlacklistApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for ABUSEIPDB_API_KEY
   */
  static fromEnv(): Connector {
    const apiKey = process.env.ABUSEIPDB_API_KEY;

    if (!apiKey) {
      throw new Error('ABUSEIPDB_API_KEY environment variable is required');
    }
    return new Connector({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { CheckApi } from './check';
export { ReportApi } from './report';
export { BlacklistApi } from './blacklist';
