import type { ResendConfig } from '../types';
import { ResendClient } from './client';
import { EmailsApi } from './emails';
import { TemplatesApi } from './templates';
import { DomainsApi } from './domains';
import { ApiKeysApi } from './api-keys';
import { AudiencesApi } from './audiences';
import { ContactsApi } from './contacts';
import { WebhooksApi } from './webhooks';
import { BroadcastsApi } from './broadcasts';

/**
 * Main Resend API client
 * Provides access to all Resend API endpoints
 */
export class Resend {
  private readonly client: ResendClient;

  // API modules
  public readonly emails: EmailsApi;
  public readonly templates: TemplatesApi;
  public readonly domains: DomainsApi;
  public readonly apiKeys: ApiKeysApi;
  public readonly audiences: AudiencesApi;
  public readonly contacts: ContactsApi;
  public readonly webhooks: WebhooksApi;
  public readonly broadcasts: BroadcastsApi;

  constructor(config: ResendConfig) {
    this.client = new ResendClient(config);
    this.emails = new EmailsApi(this.client);
    this.templates = new TemplatesApi(this.client);
    this.domains = new DomainsApi(this.client);
    this.apiKeys = new ApiKeysApi(this.client);
    this.audiences = new AudiencesApi(this.client);
    this.contacts = new ContactsApi(this.client);
    this.webhooks = new WebhooksApi(this.client);
    this.broadcasts = new BroadcastsApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for RESEND_API_KEY
   */
  static fromEnv(): Resend {
    const apiKey = process.env.RESEND_API_KEY;

    if (!apiKey) {
      throw new Error('RESEND_API_KEY environment variable is required');
    }
    return new Resend({ apiKey });
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
  getClient(): ResendClient {
    return this.client;
  }
}

export { ResendClient } from './client';
export { EmailsApi } from './emails';
export { TemplatesApi } from './templates';
export { DomainsApi } from './domains';
export { ApiKeysApi } from './api-keys';
export { AudiencesApi } from './audiences';
export { ContactsApi } from './contacts';
export { WebhooksApi } from './webhooks';
export { BroadcastsApi } from './broadcasts';
