import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { FinancialAccountsApi } from './financial-accounts';
import { TransactionsApi } from './transactions';
import { TransactionEntriesApi } from './transaction-entries';
import { OutboundPaymentsApi } from './outbound-payments';
import { OutboundTransfersApi } from './outbound-transfers';
import { InboundTransfersApi } from './inbound-transfers';
import { ReceivedCreditsApi } from './received-credits';
import { ReceivedDebitsApi } from './received-debits';
import { CreditReversalsApi } from './credit-reversals';
import { DebitReversalsApi } from './debit-reversals';

/**
 * Stripe Treasury API Connector class
 */
export class Connector {
  private readonly client: ConnectorClient;

  // API modules
  public readonly financialAccounts: FinancialAccountsApi;
  public readonly transactions: TransactionsApi;
  public readonly transactionEntries: TransactionEntriesApi;
  public readonly outboundPayments: OutboundPaymentsApi;
  public readonly outboundTransfers: OutboundTransfersApi;
  public readonly inboundTransfers: InboundTransfersApi;
  public readonly receivedCredits: ReceivedCreditsApi;
  public readonly receivedDebits: ReceivedDebitsApi;
  public readonly creditReversals: CreditReversalsApi;
  public readonly debitReversals: DebitReversalsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.financialAccounts = new FinancialAccountsApi(this.client);
    this.transactions = new TransactionsApi(this.client);
    this.transactionEntries = new TransactionEntriesApi(this.client);
    this.outboundPayments = new OutboundPaymentsApi(this.client);
    this.outboundTransfers = new OutboundTransfersApi(this.client);
    this.inboundTransfers = new InboundTransfersApi(this.client);
    this.receivedCredits = new ReceivedCreditsApi(this.client);
    this.receivedDebits = new ReceivedDebitsApi(this.client);
    this.creditReversals = new CreditReversalsApi(this.client);
    this.debitReversals = new DebitReversalsApi(this.client);
  }

  /**
   * Create a client from an API key directly.
   */
  static fromApiKey(apiKey: string, options?: Omit<ConnectorConfig, 'apiKey'>): Connector {
    return new Connector({ apiKey, ...options });
  }

  /**
   * Create a client from environment variables.
   * Looks for STRIPE_API_KEY and optionally STRIPE_ACCOUNT_ID.
   */
  static fromEnv(): Connector {
    const apiKey = process.env.STRIPE_API_KEY;
    const accountId = process.env.STRIPE_ACCOUNT_ID;

    if (!apiKey) {
      throw new Error('STRIPE_API_KEY environment variable is required');
    }
    return new Connector({ apiKey, accountId });
  }

  /**
   * Get a masked preview of the API key (for debugging)
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): ConnectorClient {
    return this.client;
  }
}

// Export client and all API classes
export { ConnectorClient } from './client';
export { FinancialAccountsApi } from './financial-accounts';
export { TransactionsApi } from './transactions';
export { TransactionEntriesApi } from './transaction-entries';
export { OutboundPaymentsApi } from './outbound-payments';
export { OutboundTransfersApi } from './outbound-transfers';
export { InboundTransfersApi } from './inbound-transfers';
export { ReceivedCreditsApi } from './received-credits';
export { ReceivedDebitsApi } from './received-debits';
export { CreditReversalsApi } from './credit-reversals';
export { DebitReversalsApi } from './debit-reversals';
