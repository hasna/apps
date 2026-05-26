import type { PatentsViewConfig } from '../types';
import { PatentsViewClient } from './client';
import { PatentsApi } from './patents';
import { AssigneesApi } from './assignees';
import { InventorsApi } from './inventors';
import { CPCApi } from './cpc';
import { LocationsApi } from './locations';

/**
 * Main PatentsView connector class
 * Provides access to USPTO patent data via the PatentsView API
 */
export class PatentsView {
  private readonly client: PatentsViewClient;

  // API modules
  public readonly patents: PatentsApi;
  public readonly assignees: AssigneesApi;
  public readonly inventors: InventorsApi;
  public readonly cpc: CPCApi;
  public readonly locations: LocationsApi;

  constructor(config: PatentsViewConfig = {}) {
    this.client = new PatentsViewClient(config);
    this.patents = new PatentsApi(this.client);
    this.assignees = new AssigneesApi(this.client);
    this.inventors = new InventorsApi(this.client);
    this.cpc = new CPCApi(this.client);
    this.locations = new LocationsApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for PATENTSVIEW_API_KEY and optionally PATENTSVIEW_BASE_URL
   */
  static fromEnv(): PatentsView {
    const apiKey = process.env.PATENTSVIEW_API_KEY;
    const baseUrl = process.env.PATENTSVIEW_BASE_URL;

    if (!apiKey) {
      throw new Error('PATENTSVIEW_API_KEY environment variable is required');
    }
    return new PatentsView({ apiKey, baseUrl });
  }

  /**
   * Get the base URL (for debugging)
   */
  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): PatentsViewClient {
    return this.client;
  }

  /**
   * Get a preview of the API key (for debugging)
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { PatentsViewClient } from './client';
export { PatentsApi } from './patents';
export { AssigneesApi } from './assignees';
export { InventorsApi } from './inventors';
export { CPCApi } from './cpc';
export { LocationsApi } from './locations';
