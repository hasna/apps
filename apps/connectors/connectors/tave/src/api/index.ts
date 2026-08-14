import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { ContactsApi } from './contacts';
import { JobsApi } from './jobs';
import { LeadsApi } from './leads';
import { OrdersApi } from './orders';
import { RawApi } from './raw';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly contacts: ContactsApi;
  public readonly jobs: JobsApi;
  public readonly leads: LeadsApi;
  public readonly orders: OrdersApi;
  public readonly raw: RawApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.contacts = new ContactsApi(this.client);
    this.jobs = new JobsApi(this.client);
    this.leads = new LeadsApi(this.client);
    this.orders = new OrdersApi(this.client);
    this.raw = new RawApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.TAVE_API_KEY;
    const baseUrl = process.env.TAVE_BASE_URL;

    if (!apiKey) {
      throw new Error('TAVE_API_KEY environment variable is required');
    }
    return new Connector({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { ContactsApi } from './contacts';
export { JobsApi } from './jobs';
export { LeadsApi } from './leads';
export { OrdersApi } from './orders';
export { RawApi } from './raw';
