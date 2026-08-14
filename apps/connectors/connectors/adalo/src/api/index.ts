import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { RecordsApi } from './records';
import { NotificationsApi } from './notifications';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly records: RecordsApi;
  public readonly notifications: NotificationsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.records = new RecordsApi(this.client);
    this.notifications = new NotificationsApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.ADALO_API_KEY;
    if (!apiKey) {
      throw new Error('ADALO_API_KEY environment variable is required');
    }
    return new Connector({ apiKey, appId: process.env.ADALO_APP_ID });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { RecordsApi } from './records';
export { NotificationsApi } from './notifications';
