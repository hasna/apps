import type { RevolutConfig } from '../types';
import { RevolutClient } from './client';
import { AccountsApi } from './accounts';
import { CounterpartiesApi } from './counterparties';
import { PaymentsApi } from './payments';
import { TransactionsApi } from './transactions';
import { ExchangeApi } from './exchange';
import { CardsApi } from './cards';

/**
 * Main Revolut Business API Connector class
 * Provides access to Accounts, Counterparties, Payments, Transactions, Exchange, and Cards APIs
 */
export class Revolut {
  private readonly client: RevolutClient;

  // Service APIs
  public readonly accounts: AccountsApi;
  public readonly counterparties: CounterpartiesApi;
  public readonly payments: PaymentsApi;
  public readonly transactions: TransactionsApi;
  public readonly exchange: ExchangeApi;
  public readonly cards: CardsApi;

  constructor(config: RevolutConfig) {
    this.client = new RevolutClient(config);
    this.accounts = new AccountsApi(this.client);
    this.counterparties = new CounterpartiesApi(this.client);
    this.payments = new PaymentsApi(this.client);
    this.transactions = new TransactionsApi(this.client);
    this.exchange = new ExchangeApi(this.client);
    this.cards = new CardsApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for REVOLUT_API_TOKEN and optionally REVOLUT_SANDBOX
   */
  static fromEnv(): Revolut {
    const apiToken = process.env.REVOLUT_API_TOKEN;
    const sandbox = process.env.REVOLUT_SANDBOX === 'true' || process.env.REVOLUT_SANDBOX === '1';

    if (!apiToken) {
      throw new Error('REVOLUT_API_TOKEN environment variable is required');
    }

    return new Revolut({ apiToken, sandbox });
  }

  /**
   * Get a preview of the API token (for debugging)
   */
  getTokenPreview(): string {
    return this.client.getTokenPreview();
  }

  /**
   * Check if using sandbox environment
   */
  isSandbox(): boolean {
    return this.client.isSandbox();
  }

  /**
   * Get base URL
   */
  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): RevolutClient {
    return this.client;
  }
}

export { RevolutClient } from './client';
export { AccountsApi } from './accounts';
export { CounterpartiesApi } from './counterparties';
export { PaymentsApi } from './payments';
export { TransactionsApi } from './transactions';
export { ExchangeApi } from './exchange';
export { CardsApi } from './cards';
