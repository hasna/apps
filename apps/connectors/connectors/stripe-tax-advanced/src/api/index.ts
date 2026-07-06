import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { CalculationsApi } from './calculations';
import { TransactionsApi } from './transactions';
import { RegistrationsApi } from './registrations';
import { SettingsApi } from './settings';

export { ConnectorClient } from './client';
export { CalculationsApi } from './calculations';
export { TransactionsApi } from './transactions';
export { RegistrationsApi } from './registrations';
export { SettingsApi } from './settings';

/**
 * Stripe Tax Advanced API connector
 * https://docs.stripe.com/tax
 */
export class Connector {
  private readonly client: ConnectorClient;

  public readonly calculations: CalculationsApi;
  public readonly transactions: TransactionsApi;
  public readonly registrations: RegistrationsApi;
  public readonly settings: SettingsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.calculations = new CalculationsApi(this.client);
    this.transactions = new TransactionsApi(this.client);
    this.registrations = new RegistrationsApi(this.client);
    this.settings = new SettingsApi(this.client);
  }

  static fromApiKey(apiKey: string, options?: Omit<ConnectorConfig, 'apiKey'>): Connector {
    return new Connector({ apiKey, ...options });
  }

  static fromEnv(): Connector {
    const apiKey = process.env.STRIPE_API_KEY;
    if (!apiKey) {
      throw new Error('STRIPE_API_KEY environment variable is required');
    }
    return new Connector({
      apiKey,
      accountId: process.env.STRIPE_ACCOUNT_ID,
      baseUrl: process.env.STRIPE_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}
