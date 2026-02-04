import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { BalanceApi } from './balance';
import { ProductsApi } from './products';
import { PricesApi } from './prices';
import { CustomersApi } from './customers';
import { SubscriptionsApi } from './subscriptions';
import { SubscriptionItemsApi } from './subscription-items';
import { PaymentIntentsApi } from './payment-intents';
import { PaymentMethodsApi } from './payment-methods';
import { ChargesApi } from './charges';
import { InvoicesApi } from './invoices';
import { InvoiceItemsApi } from './invoice-items';
import { CouponsApi } from './coupons';
import { PromotionCodesApi } from './promotion-codes';
import { EventsApi } from './events';
import { WebhooksApi } from './webhooks';
import { CheckoutSessionsApi } from './checkout-sessions';
import { PaymentLinksApi } from './payment-links';
import { BillingPortalApi } from './billing-portal';

/**
 * Stripe API Connector class
 */
export class Connector {
  private readonly client: ConnectorClient;

  // API modules
  public readonly balance: BalanceApi;
  public readonly products: ProductsApi;
  public readonly prices: PricesApi;
  public readonly customers: CustomersApi;
  public readonly subscriptions: SubscriptionsApi;
  public readonly subscriptionItems: SubscriptionItemsApi;
  public readonly paymentIntents: PaymentIntentsApi;
  public readonly paymentMethods: PaymentMethodsApi;
  public readonly charges: ChargesApi;
  public readonly invoices: InvoicesApi;
  public readonly invoiceItems: InvoiceItemsApi;
  public readonly coupons: CouponsApi;
  public readonly promotionCodes: PromotionCodesApi;
  public readonly events: EventsApi;
  public readonly webhooks: WebhooksApi;
  public readonly checkoutSessions: CheckoutSessionsApi;
  public readonly paymentLinks: PaymentLinksApi;
  public readonly billingPortal: BillingPortalApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.balance = new BalanceApi(this.client);
    this.products = new ProductsApi(this.client);
    this.prices = new PricesApi(this.client);
    this.customers = new CustomersApi(this.client);
    this.subscriptions = new SubscriptionsApi(this.client);
    this.subscriptionItems = new SubscriptionItemsApi(this.client);
    this.paymentIntents = new PaymentIntentsApi(this.client);
    this.paymentMethods = new PaymentMethodsApi(this.client);
    this.charges = new ChargesApi(this.client);
    this.invoices = new InvoicesApi(this.client);
    this.invoiceItems = new InvoiceItemsApi(this.client);
    this.coupons = new CouponsApi(this.client);
    this.promotionCodes = new PromotionCodesApi(this.client);
    this.events = new EventsApi(this.client);
    this.webhooks = new WebhooksApi(this.client);
    this.checkoutSessions = new CheckoutSessionsApi(this.client);
    this.paymentLinks = new PaymentLinksApi(this.client);
    this.billingPortal = new BillingPortalApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for STRIPE_API_KEY and optionally STRIPE_API_SECRET
   */
  static fromEnv(): Connector {
    const apiKey = process.env.STRIPE_API_KEY;
    const apiSecret = process.env.STRIPE_API_SECRET;

    if (!apiKey) {
      throw new Error('STRIPE_API_KEY environment variable is required');
    }
    return new Connector({ apiKey, apiSecret });
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
  getClient(): ConnectorClient {
    return this.client;
  }
}

// Export client and all API classes
export { ConnectorClient } from './client';
export { BalanceApi } from './balance';
export { ProductsApi } from './products';
export { PricesApi } from './prices';
export { CustomersApi } from './customers';
export { SubscriptionsApi } from './subscriptions';
export { SubscriptionItemsApi } from './subscription-items';
export { PaymentIntentsApi } from './payment-intents';
export { PaymentMethodsApi } from './payment-methods';
export { ChargesApi } from './charges';
export { InvoicesApi } from './invoices';
export { InvoiceItemsApi } from './invoice-items';
export { CouponsApi } from './coupons';
export { PromotionCodesApi } from './promotion-codes';
export { EventsApi } from './events';
export { WebhooksApi } from './webhooks';
export { CheckoutSessionsApi } from './checkout-sessions';
export { PaymentLinksApi } from './payment-links';
export { BillingPortalApi } from './billing-portal';
