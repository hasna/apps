import type { WufooConfig } from '../types';
import { WufooClient } from './client';
import { FormsApi } from './forms';
import { EntriesApi } from './entries';
import { ReportsApi } from './reports';
import { UsersApi } from './users';
import { WebhooksApi } from './webhooks';

export class Wufoo {
  private readonly client: WufooClient;

  public readonly forms: FormsApi;
  public readonly entries: EntriesApi;
  public readonly reports: ReportsApi;
  public readonly users: UsersApi;
  public readonly webhooks: WebhooksApi;

  constructor(config: WufooConfig) {
    this.client = new WufooClient(config);
    this.forms = new FormsApi(this.client);
    this.entries = new EntriesApi(this.client);
    this.reports = new ReportsApi(this.client);
    this.users = new UsersApi(this.client);
    this.webhooks = new WebhooksApi(this.client);
  }

  static fromEnv(): Wufoo {
    const apiKey = process.env.WUFOO_API_KEY;
    const subdomain = process.env.WUFOO_SUBDOMAIN;
    const baseUrl = process.env.WUFOO_BASE_URL;

    if (!apiKey) {
      throw new Error('WUFOO_API_KEY environment variable is required');
    }
    if (!subdomain && !baseUrl) {
      throw new Error('WUFOO_SUBDOMAIN environment variable is required');
    }

    return new Wufoo({ apiKey, subdomain: subdomain || '', baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }

  getClient(): WufooClient {
    return this.client;
  }
}

export { WufooClient, buildWufooBaseUrl, encodeResourceId } from './client';
export { FormsApi } from './forms';
export { EntriesApi } from './entries';
export { ReportsApi } from './reports';
export { UsersApi } from './users';
export { WebhooksApi } from './webhooks';
