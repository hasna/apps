import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { CertificatesApi } from './certificates';
import { EventsApi } from './events';
import { SearchApi } from './search';
import { RawApi } from './raw';

/** Venafi TLS Protect Cloud API connector */
export class Connector {
  private readonly client: ConnectorClient;

  public readonly certificates: CertificatesApi;
  public readonly events: EventsApi;
  public readonly search: SearchApi;
  public readonly raw: RawApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.certificates = new CertificatesApi(this.client);
    this.events = new EventsApi(this.client);
    this.search = new SearchApi(this.client);
    this.raw = new RawApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.VENAFI_API_KEY;
    const baseUrl = process.env.VENAFI_BASE_URL;

    if (!apiKey) {
      throw new Error('VENAFI_API_KEY environment variable is required');
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

export { ConnectorClient, DEFAULT_BASE_URL } from './client';
export { CertificatesApi } from './certificates';
export { EventsApi } from './events';
export { SearchApi } from './search';
export { RawApi } from './raw';
