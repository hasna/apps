import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { CardholdersApi } from './cardholders';
import { CardsApi } from './cards';
import { AuthorizationsApi } from './authorizations';
import { TransactionsApi } from './transactions';
import { EventsApi } from './events';
import { RawApi } from './raw';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly cardholders: CardholdersApi;
  public readonly cards: CardsApi;
  public readonly authorizations: AuthorizationsApi;
  public readonly transactions: TransactionsApi;
  public readonly events: EventsApi;
  public readonly raw: RawApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.cardholders = new CardholdersApi(this.client);
    this.cards = new CardsApi(this.client);
    this.authorizations = new AuthorizationsApi(this.client);
    this.transactions = new TransactionsApi(this.client);
    this.events = new EventsApi(this.client);
    this.raw = new RawApi(this.client);
  }

  static fromApiKey(apiKey: string, options?: Omit<ConnectorConfig, 'apiKey'>): Connector {
    return new Connector({ apiKey, ...options });
  }

  static fromEnv(): Connector {
    const apiKey = process.env.STRIPE_ISSUING_API_KEY;
    const accountId = process.env.STRIPE_ISSUING_ACCOUNT_ID;
    const baseUrl = process.env.STRIPE_ISSUING_BASE_URL;
    const apiVersion = process.env.STRIPE_ISSUING_API_VERSION;

    if (!apiKey) {
      throw new Error('STRIPE_ISSUING_API_KEY environment variable is required');
    }

    return new Connector({ apiKey, accountId, baseUrl, apiVersion });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { CardholdersApi } from './cardholders';
export { CardsApi } from './cards';
export { AuthorizationsApi } from './authorizations';
export { TransactionsApi } from './transactions';
export { EventsApi } from './events';
export { RawApi } from './raw';
