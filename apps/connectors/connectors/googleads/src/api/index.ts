import { GoogleAdsClient } from './client';
import { CampaignsApi } from './campaigns';
import { AdGroupsApi } from './adGroups';
import { AdsApi } from './ads';
import { KeywordsApi } from './keywords';
import { ReportsApi } from './reports';
import { BulkApi } from './bulk';
import type { GoogleAdsConfig, SearchResponse } from '../types';

export class GoogleAds {
  private client: GoogleAdsClient;

  public campaigns: CampaignsApi;
  public adGroups: AdGroupsApi;
  public ads: AdsApi;
  public keywords: KeywordsApi;
  public reports: ReportsApi;
  public bulk: BulkApi;

  constructor(config: GoogleAdsConfig) {
    this.client = new GoogleAdsClient(config);

    this.campaigns = new CampaignsApi(this.client);
    this.adGroups = new AdGroupsApi(this.client);
    this.ads = new AdsApi(this.client);
    this.keywords = new KeywordsApi(this.client);
    this.reports = new ReportsApi(this.client);
    this.bulk = new BulkApi(this.client);
  }

  /**
   * Set the customer ID for subsequent requests
   */
  setCustomerId(customerId: string): void {
    this.client.setCustomerId(customerId);
  }

  /**
   * Execute a raw GAQL query
   */
  async query(gaqlQuery: string): Promise<SearchResponse> {
    return this.client.search(gaqlQuery);
  }

  /**
   * Execute a streaming GAQL query for large datasets
   */
  async queryStream(gaqlQuery: string): Promise<SearchResponse> {
    return this.client.searchStream(gaqlQuery);
  }

  /**
   * Get customer account info
   */
  async getCustomer(): Promise<SearchResponse> {
    return this.client.getCustomer();
  }

  /**
   * List accessible customers (for manager accounts)
   */
  async listAccessibleCustomers(): Promise<{ resourceNames: string[] }> {
    return this.client.listAccessibleCustomers();
  }

  /**
   * Get customer client accounts (for manager accounts)
   */
  async getCustomerClients(): Promise<SearchResponse> {
    return this.client.getCustomerClients();
  }
}

export { GoogleAdsClient } from './client';
export { CampaignsApi } from './campaigns';
export { AdGroupsApi } from './adGroups';
export { AdsApi } from './ads';
export { KeywordsApi } from './keywords';
export { ReportsApi } from './reports';
export { BulkApi } from './bulk';
