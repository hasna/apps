import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { VerificationSessionsApi } from './verification-sessions';
import { VerificationReportsApi } from './verification-reports';

/**
 * Stripe Identity API Connector class
 */
export class Connector {
  private readonly client: ConnectorClient;

  // API modules
  public readonly verificationSessions: VerificationSessionsApi;
  public readonly verificationReports: VerificationReportsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.verificationSessions = new VerificationSessionsApi(this.client);
    this.verificationReports = new VerificationReportsApi(this.client);
  }

  /**
   * Create a client from an API key directly.
   */
  static fromApiKey(apiKey: string, options?: Omit<ConnectorConfig, 'apiKey'>): Connector {
    return new Connector({ apiKey, ...options });
  }

  /**
   * Create a client from environment variables.
   * Looks for STRIPE_IDENTITY_API_KEY and optionally STRIPE_IDENTITY_ACCOUNT_ID.
   */
  static fromEnv(): Connector {
    const apiKey = process.env.STRIPE_IDENTITY_API_KEY;
    const accountId = process.env.STRIPE_IDENTITY_ACCOUNT_ID;

    if (!apiKey) {
      throw new Error('STRIPE_IDENTITY_API_KEY environment variable is required');
    }
    return new Connector({ apiKey, accountId });
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
export { VerificationSessionsApi } from './verification-sessions';
export { VerificationReportsApi } from './verification-reports';
