import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { AccountsApi } from './accounts';
import { AccountLinksApi } from './account-links';
import { LoginLinksApi } from './login-links';
import { TransfersApi } from './transfers';
import { ApplicationFeesApi } from './application-fees';
import { RawRequestApi } from './raw';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly accounts: AccountsApi;
  public readonly accountLinks: AccountLinksApi;
  public readonly loginLinks: LoginLinksApi;
  public readonly transfers: TransfersApi;
  public readonly applicationFees: ApplicationFeesApi;
  public readonly raw: RawRequestApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.accounts = new AccountsApi(this.client);
    this.accountLinks = new AccountLinksApi(this.client);
    this.loginLinks = new LoginLinksApi(this.client);
    this.transfers = new TransfersApi(this.client);
    this.applicationFees = new ApplicationFeesApi(this.client);
    this.raw = new RawRequestApi(this.client);
  }

  static fromApiKey(apiKey: string, options?: Omit<ConnectorConfig, 'apiKey'>): Connector {
    return new Connector({ apiKey, ...options });
  }

  static fromEnv(): Connector {
    const apiKey = process.env.STRIPE_CONNECT_PLATFORM_API_KEY;
    if (!apiKey) {
      throw new Error('STRIPE_CONNECT_PLATFORM_API_KEY environment variable is required');
    }

    return new Connector({
      apiKey,
      baseUrl: process.env.STRIPE_CONNECT_PLATFORM_BASE_URL,
      accountId: process.env.STRIPE_CONNECT_PLATFORM_ACCOUNT_ID,
      connectedAccountId: process.env.STRIPE_CONNECT_PLATFORM_CONNECTED_ACCOUNT_ID,
      apiVersion: process.env.STRIPE_CONNECT_PLATFORM_API_VERSION,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { AccountsApi } from './accounts';
export { AccountLinksApi } from './account-links';
export { LoginLinksApi } from './login-links';
export { TransfersApi } from './transfers';
export { ApplicationFeesApi } from './application-fees';
export { RawRequestApi } from './raw';
