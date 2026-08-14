import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { UsersApi } from './users';
import { EventsApi } from './events';
import { BulkApi } from './bulk';
import { TransactionalApi } from './transactional';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly users: UsersApi;
  public readonly events: EventsApi;
  public readonly bulk: BulkApi;
  public readonly transactional: TransactionalApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.users = new UsersApi(this.client);
    this.events = new EventsApi(this.client);
    this.bulk = new BulkApi(this.client);
    this.transactional = new TransactionalApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.WEBENGAGE_API_KEY || process.env.WEBENGAGE_TOKEN;
    const licenseCode = process.env.WEBENGAGE_LICENSE_CODE;
    const dataCenter = process.env.WEBENGAGE_DC as ConnectorConfig['dataCenter'];
    const baseUrl = process.env.WEBENGAGE_BASE_URL;

    if (!apiKey) {
      throw new Error('WEBENGAGE_API_KEY environment variable is required');
    }
    if (!licenseCode) {
      throw new Error('WEBENGAGE_LICENSE_CODE environment variable is required');
    }

    return new Connector({ apiKey, licenseCode, dataCenter, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getLicenseCode(): string {
    return this.client.getLicenseCode();
  }

  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient, resolveBaseUrl } from './client';
export { UsersApi } from './users';
export { EventsApi } from './events';
export { BulkApi } from './bulk';
export { TransactionalApi } from './transactional';
