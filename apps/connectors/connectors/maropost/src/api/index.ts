import type { MaropostConfig } from '../types';
import { MaropostClient } from './client';
import { ContactsApi } from './contacts';
import { ListsApi } from './lists';
import { CampaignsApi } from './campaigns';
import { ReportsApi } from './reports';
import { JourneysApi } from './journeys';
import { TransactionalApi } from './transactional';

/**
 * Main Maropost API class
 * Provides access to all Maropost Marketing Cloud API modules
 */
export class Maropost {
  private readonly client: MaropostClient;

  // API modules
  public readonly contacts: ContactsApi;
  public readonly lists: ListsApi;
  public readonly campaigns: CampaignsApi;
  public readonly reports: ReportsApi;
  public readonly journeys: JourneysApi;
  public readonly transactional: TransactionalApi;

  constructor(config: MaropostConfig) {
    this.client = new MaropostClient(config);
    this.contacts = new ContactsApi(this.client);
    this.lists = new ListsApi(this.client);
    this.campaigns = new CampaignsApi(this.client);
    this.reports = new ReportsApi(this.client);
    this.journeys = new JourneysApi(this.client);
    this.transactional = new TransactionalApi(config.apiKey);
  }

  /**
   * Create a client from environment variables
   * Looks for MAROPOST_API_KEY and MAROPOST_ACCOUNT_ID
   */
  static fromEnv(): Maropost {
    const apiKey = process.env.MAROPOST_API_KEY;
    const accountIdStr = process.env.MAROPOST_ACCOUNT_ID;
    const baseUrl = process.env.MAROPOST_BASE_URL;

    if (!apiKey) {
      throw new Error('MAROPOST_API_KEY environment variable is required');
    }
    if (!accountIdStr) {
      throw new Error('MAROPOST_ACCOUNT_ID environment variable is required');
    }

    const accountId = parseInt(accountIdStr, 10);
    if (isNaN(accountId)) {
      throw new Error('MAROPOST_ACCOUNT_ID must be a valid number');
    }

    return new Maropost({ apiKey, accountId, baseUrl });
  }

  /**
   * Get a preview of the API key (for debugging)
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get the account ID
   */
  getAccountId(): number {
    return this.client.getAccountId();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): MaropostClient {
    return this.client;
  }
}

// Alias for backward compatibility
export const Connector = Maropost;

// Export all modules
export { MaropostClient, ConnectorClient } from './client';
export { ContactsApi } from './contacts';
export { ListsApi } from './lists';
export { CampaignsApi } from './campaigns';
export { ReportsApi } from './reports';
export { JourneysApi } from './journeys';
export { TransactionalApi } from './transactional';
