import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { ReportTypesApi } from './report-types';
import { ReportRunsApi } from './report-runs';

/**
 * Stripe Reporting (Advanced) API Connector class.
 * Wraps the Stripe Reporting API for scheduled financial report generation.
 */
export class Connector {
  private readonly client: ConnectorClient;

  // API modules
  public readonly reportTypes: ReportTypesApi;
  public readonly reportRuns: ReportRunsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.reportTypes = new ReportTypesApi(this.client);
    this.reportRuns = new ReportRunsApi(this.client);
  }

  /**
   * Create a client from an API key directly.
   */
  static fromApiKey(apiKey: string, options?: Omit<ConnectorConfig, 'apiKey'>): Connector {
    return new Connector({ apiKey, ...options });
  }

  /**
   * Create a client from environment variables.
   * Looks for STRIPE_API_KEY and optionally STRIPE_BASE_URL / STRIPE_API_VERSION.
   */
  static fromEnv(): Connector {
    const apiKey = process.env.STRIPE_API_KEY;
    if (!apiKey) {
      throw new Error('STRIPE_API_KEY environment variable is required');
    }
    return new Connector({
      apiKey,
      baseUrl: process.env.STRIPE_BASE_URL,
      apiVersion: process.env.STRIPE_API_VERSION,
    });
  }

  /**
   * Get a preview of the API key (for debugging).
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get the underlying client for direct API access.
   */
  getClient(): ConnectorClient {
    return this.client;
  }
}

// Aliases for backwards compatibility with scaffold patterns
export { Connector as StripeReporting };
export { ConnectorClient } from './client';
export { ReportTypesApi } from './report-types';
export { ReportRunsApi } from './report-runs';
