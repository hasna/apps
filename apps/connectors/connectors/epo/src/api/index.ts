import type { EPOConfig } from '../types';
import { EPOClient } from './client';
import { PublicationsApi } from './publications';
import { FamilyApi } from './family';
import { LegalApi } from './legal';
import { RegisterApi } from './register';
import { ClassificationApi } from './classification';

/**
 * Main EPO OPS connector class
 */
export class EPO {
  private readonly client: EPOClient;

  // API modules
  public readonly publications: PublicationsApi;
  public readonly family: FamilyApi;
  public readonly legal: LegalApi;
  public readonly register: RegisterApi;
  public readonly classification: ClassificationApi;

  constructor(config: EPOConfig) {
    this.client = new EPOClient(config);
    this.publications = new PublicationsApi(this.client);
    this.family = new FamilyApi(this.client);
    this.legal = new LegalApi(this.client);
    this.register = new RegisterApi(this.client);
    this.classification = new ClassificationApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for EPO_CONSUMER_KEY and EPO_CONSUMER_SECRET
   */
  static fromEnv(): EPO {
    const consumerKey = process.env.EPO_CONSUMER_KEY;
    const consumerSecret = process.env.EPO_CONSUMER_SECRET;
    const baseUrl = process.env.EPO_BASE_URL;

    if (!consumerKey) {
      throw new Error('EPO_CONSUMER_KEY environment variable is required');
    }
    if (!consumerSecret) {
      throw new Error('EPO_CONSUMER_SECRET environment variable is required');
    }
    return new EPO({ consumerKey, consumerSecret, baseUrl });
  }

  /**
   * Get a preview of the consumer key (for debugging)
   */
  getConsumerKeyPreview(): string {
    return this.client.getConsumerKeyPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): EPOClient {
    return this.client;
  }

  /**
   * Force authentication (get a new token)
   */
  async authenticate(): Promise<void> {
    await this.client.authenticate();
  }

  /**
   * Check if we have a valid token
   */
  hasValidToken(): boolean {
    return this.client.hasValidToken();
  }

  /**
   * Get token expiry time
   */
  getTokenExpiry(): Date | null {
    return this.client.getTokenExpiry();
  }

  /**
   * Clear the cached token
   */
  clearToken(): void {
    this.client.clearToken();
  }
}

export { EPOClient } from './client';
export { PublicationsApi } from './publications';
export { FamilyApi } from './family';
export { LegalApi } from './legal';
export { RegisterApi } from './register';
export { ClassificationApi } from './classification';
