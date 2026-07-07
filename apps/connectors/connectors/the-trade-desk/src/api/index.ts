import type { ConnectorConfig, JsonRecord, RawRequestOptions } from '../types';
import { DEFAULT_BASE_URL, ConnectorClient } from './client';
import { CampaignsApi } from './campaigns';
import { EventsApi } from './events';
import { SearchApi } from './search';
import { getApiKey, getBaseUrl } from '../utils/config';

export class TheTradeDesk {
  private readonly client: ConnectorClient;

  public readonly campaigns: CampaignsApi;
  public readonly events: EventsApi;
  public readonly search: SearchApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.campaigns = new CampaignsApi(this.client);
    this.events = new EventsApi(this.client);
    this.search = new SearchApi(this.client);
  }

  static fromEnv(): TheTradeDesk {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error('THE_TRADE_DESK_API_KEY environment variable is required');
    }
    return new TheTradeDesk({ apiKey, baseUrl: getBaseUrl() });
  }

  async rawRequest<T = JsonRecord>(options: RawRequestOptions): Promise<T> {
    const { method = 'GET', path, params, body } = options;
    return this.client.request<T>(path, { method, params, body });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }

  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }
}

export { ConnectorClient, DEFAULT_BASE_URL } from './client';
export { CampaignsApi } from './campaigns';
export { EventsApi } from './events';
export { SearchApi } from './search';

export function createConnector(config?: ConnectorConfig): TheTradeDesk {
  const apiKey = config?.apiKey || config?.token || getApiKey();
  if (!apiKey) {
    throw new Error('API key is required');
  }
  return new TheTradeDesk({
    apiKey,
    baseUrl: config?.baseUrl || getBaseUrl(),
  });
}
