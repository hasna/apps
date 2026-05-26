import type { ContactOutConfig } from '../types';
import { ContactOutClient } from './client';
import { LinkedInApi } from './linkedin';
import { PeopleApi } from './people';
import { CompanyApi } from './company';
import { EmailApi } from './email';
import { StatsApi } from './stats';

/**
 * ContactOut API Client
 * Find emails, phone numbers, and enrich LinkedIn profiles
 */
export class ContactOut {
  private readonly client: ContactOutClient;

  // API modules
  public readonly linkedin: LinkedInApi;
  public readonly people: PeopleApi;
  public readonly company: CompanyApi;
  public readonly email: EmailApi;
  public readonly stats: StatsApi;

  constructor(config: ContactOutConfig) {
    this.client = new ContactOutClient(config);
    this.linkedin = new LinkedInApi(this.client);
    this.people = new PeopleApi(this.client);
    this.company = new CompanyApi(this.client);
    this.email = new EmailApi(this.client);
    this.stats = new StatsApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for CONTACTOUT_API_KEY
   */
  static fromEnv(): ContactOut {
    const apiKey = process.env.CONTACTOUT_API_KEY;

    if (!apiKey) {
      throw new Error('CONTACTOUT_API_KEY environment variable is required');
    }
    return new ContactOut({ apiKey });
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
  getClient(): ContactOutClient {
    return this.client;
  }
}

export { ContactOutClient } from './client';
export { LinkedInApi } from './linkedin';
export { PeopleApi } from './people';
export { CompanyApi } from './company';
export { EmailApi } from './email';
export { StatsApi } from './stats';
