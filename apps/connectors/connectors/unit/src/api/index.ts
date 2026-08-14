import type { UnitConfig } from '../types';
import { UnitClient } from './client';
import { AccountsApi } from './accounts';
import { ApplicationsApi } from './applications';
import { CustomersApi } from './customers';
import { CardsApi } from './cards';
import { TransactionsApi } from './transactions';
import { PaymentsApi } from './payments';
import { CounterpartiesApi } from './counterparties';
import { WebhooksApi } from './webhooks';
import { EventsApi } from './events';

/**
 * Unit.sh Banking-as-a-Service API client.
 */
export class Unit {
  private readonly client: UnitClient;

  public readonly accounts: AccountsApi;
  public readonly applications: ApplicationsApi;
  public readonly customers: CustomersApi;
  public readonly cards: CardsApi;
  public readonly transactions: TransactionsApi;
  public readonly payments: PaymentsApi;
  public readonly counterparties: CounterpartiesApi;
  public readonly webhooks: WebhooksApi;
  public readonly events: EventsApi;

  constructor(config: UnitConfig) {
    this.client = new UnitClient(config);
    this.accounts = new AccountsApi(this.client);
    this.applications = new ApplicationsApi(this.client);
    this.customers = new CustomersApi(this.client);
    this.cards = new CardsApi(this.client);
    this.transactions = new TransactionsApi(this.client);
    this.payments = new PaymentsApi(this.client);
    this.counterparties = new CounterpartiesApi(this.client);
    this.webhooks = new WebhooksApi(this.client);
    this.events = new EventsApi(this.client);
  }

  static fromEnv(): Unit {
    const apiToken = process.env.UNIT_API_TOKEN;
    if (!apiToken) {
      throw new Error('UNIT_API_TOKEN environment variable is required');
    }
    const environment = (process.env.UNIT_ENVIRONMENT?.toLowerCase() ?? 'sandbox') as UnitConfig['environment'];
    return new Unit({ apiToken, environment });
  }

  getTokenPreview(): string {
    return this.client.getTokenPreview();
  }

  getClient(): UnitClient {
    return this.client;
  }
}

export { UnitClient, buildQuery, jsonApiBody, ENV_BASES } from './client';
export { AccountsApi } from './accounts';
export { ApplicationsApi } from './applications';
export { CustomersApi } from './customers';
export { CardsApi } from './cards';
export { TransactionsApi } from './transactions';
export { PaymentsApi } from './payments';
export { CounterpartiesApi } from './counterparties';
export { WebhooksApi } from './webhooks';
export { EventsApi } from './events';
