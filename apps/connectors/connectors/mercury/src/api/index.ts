import type { MercuryConfig } from '../types';
import { MercuryClient } from './client';
import { AccountsApi } from './accounts';
import { TransactionsApi } from './transactions';
import { RecipientsApi } from './recipients';
import { TransfersApi } from './transfers';
import { InvoicesApi } from './invoices';
import { CustomersApi } from './customers';
import { TreasuryApi } from './treasury';
import { OrganizationApi } from './organization';
import { WebhooksApi } from './webhooks';
import { CategoriesApi } from './categories';
import { CreditApi } from './credit';
import { EventsApi } from './events';
import { AttachmentsApi } from './attachments';

/**
 * Mercury Banking API client
 * Provides access to all Mercury API endpoints
 */
export class Mercury {
  private readonly client: MercuryClient;

  // API modules
  public readonly accounts: AccountsApi;
  public readonly transactions: TransactionsApi;
  public readonly recipients: RecipientsApi;
  public readonly transfers: TransfersApi;
  public readonly invoices: InvoicesApi;
  public readonly customers: CustomersApi;
  public readonly treasury: TreasuryApi;
  public readonly organization: OrganizationApi;
  public readonly webhooks: WebhooksApi;
  public readonly categories: CategoriesApi;
  public readonly credit: CreditApi;
  public readonly events: EventsApi;
  public readonly attachments: AttachmentsApi;

  constructor(config: MercuryConfig) {
    this.client = new MercuryClient(config);
    this.accounts = new AccountsApi(this.client);
    this.transactions = new TransactionsApi(this.client);
    this.recipients = new RecipientsApi(this.client);
    this.transfers = new TransfersApi(this.client);
    this.invoices = new InvoicesApi(this.client);
    this.customers = new CustomersApi(this.client);
    this.treasury = new TreasuryApi(this.client);
    this.organization = new OrganizationApi(this.client);
    this.webhooks = new WebhooksApi(this.client);
    this.categories = new CategoriesApi(this.client);
    this.credit = new CreditApi(this.client);
    this.events = new EventsApi(this.client);
    this.attachments = new AttachmentsApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for MERCURY_API_KEY
   */
  static fromEnv(): Mercury {
    const apiKey = process.env.MERCURY_API_KEY;

    if (!apiKey) {
      throw new Error('MERCURY_API_KEY environment variable is required');
    }
    return new Mercury({ apiKey });
  }

  /**
   * Get a preview of the API key (for debugging)
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): MercuryClient {
    return this.client;
  }
}

export { MercuryClient } from './client';
export { AccountsApi } from './accounts';
export { TransactionsApi } from './transactions';
export { RecipientsApi } from './recipients';
export { TransfersApi } from './transfers';
export { InvoicesApi } from './invoices';
export { CustomersApi } from './customers';
export { TreasuryApi } from './treasury';
export { OrganizationApi } from './organization';
export { WebhooksApi } from './webhooks';
export { CategoriesApi } from './categories';
export { CreditApi } from './credit';
export { EventsApi } from './events';
export { AttachmentsApi } from './attachments';
