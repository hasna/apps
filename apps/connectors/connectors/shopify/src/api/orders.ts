import type { ShopifyClient } from './client';
import type { Order, Fulfillment, FulfillOrderRequest, LineItem, Customer, Address, MoneySet, Refund } from '../types';

export interface ListOrdersOptions {
  limit?: number;
  sinceId?: number;
  createdAtMin?: string;
  createdAtMax?: string;
  updatedAtMin?: string;
  updatedAtMax?: string;
  processedAtMin?: string;
  processedAtMax?: string;
  status?: 'open' | 'closed' | 'cancelled' | 'any';
  financialStatus?: 'authorized' | 'pending' | 'paid' | 'partially_paid' | 'refunded' | 'voided' | 'partially_refunded' | 'any' | 'unpaid';
  fulfillmentStatus?: 'shipped' | 'partial' | 'unshipped' | 'any' | 'unfulfilled';
  ids?: string;
  fields?: string;
}

/**
 * Shopify Orders API
 */
export class OrdersApi {
  constructor(private readonly client: ShopifyClient) {}

  /**
   * List orders
   */
  async list(options: ListOrdersOptions = {}): Promise<Order[]> {
    const params: Record<string, string | number | boolean | undefined> = {
      limit: options.limit || 50,
      status: options.status || 'any',
    };

    if (options.sinceId) params.since_id = options.sinceId;
    if (options.createdAtMin) params.created_at_min = options.createdAtMin;
    if (options.createdAtMax) params.created_at_max = options.createdAtMax;
    if (options.updatedAtMin) params.updated_at_min = options.updatedAtMin;
    if (options.updatedAtMax) params.updated_at_max = options.updatedAtMax;
    if (options.processedAtMin) params.processed_at_min = options.processedAtMin;
    if (options.processedAtMax) params.processed_at_max = options.processedAtMax;
    if (options.financialStatus) params.financial_status = options.financialStatus;
    if (options.fulfillmentStatus) params.fulfillment_status = options.fulfillmentStatus;
    if (options.ids) params.ids = options.ids;
    if (options.fields) params.fields = options.fields;

    const response = await this.client.request<{ orders: Record<string, unknown>[] }>(
      '/orders.json',
      { params }
    );

    return this.transformOrders(response.orders);
  }

  /**
   * Get a single order by ID
   */
  async get(id: number, fields?: string): Promise<Order> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (fields) params.fields = fields;

    const response = await this.client.request<{ order: Record<string, unknown> }>(
      `/orders/${id}.json`,
      { params }
    );

    return this.transformOrder(response.order);
  }

  /**
   * Get order count
   */
  async count(options: Pick<ListOrdersOptions, 'status' | 'financialStatus' | 'fulfillmentStatus' | 'createdAtMin' | 'createdAtMax'> = {}): Promise<number> {
    const params: Record<string, string | number | boolean | undefined> = {};

    if (options.status) params.status = options.status;
    if (options.financialStatus) params.financial_status = options.financialStatus;
    if (options.fulfillmentStatus) params.fulfillment_status = options.fulfillmentStatus;
    if (options.createdAtMin) params.created_at_min = options.createdAtMin;
    if (options.createdAtMax) params.created_at_max = options.createdAtMax;

    const response = await this.client.request<{ count: number }>(
      '/orders/count.json',
      { params }
    );

    return response.count;
  }

  /**
   * Close an order
   */
  async close(id: number): Promise<Order> {
    const response = await this.client.request<{ order: Record<string, unknown> }>(
      `/orders/${id}/close.json`,
      { method: 'POST' }
    );

    return this.transformOrder(response.order);
  }

  /**
   * Re-open a closed order
   */
  async open(id: number): Promise<Order> {
    const response = await this.client.request<{ order: Record<string, unknown> }>(
      `/orders/${id}/open.json`,
      { method: 'POST' }
    );

    return this.transformOrder(response.order);
  }

  /**
   * Cancel an order
   */
  async cancel(id: number, options?: { reason?: string; email?: boolean; restock?: boolean }): Promise<Order> {
    const body: Record<string, unknown> = {};
    if (options?.reason) body.reason = options.reason;
    if (options?.email !== undefined) body.email = options.email;
    if (options?.restock !== undefined) body.restock = options.restock;

    const response = await this.client.request<{ order: Record<string, unknown> }>(
      `/orders/${id}/cancel.json`,
      { method: 'POST', body: Object.keys(body).length > 0 ? body : undefined }
    );

    return this.transformOrder(response.order);
  }

  /**
   * Create a fulfillment for an order
   */
  async fulfill(orderId: number, fulfillment: FulfillOrderRequest): Promise<Fulfillment> {
    const body = {
      fulfillment: {
        location_id: fulfillment.locationId,
        tracking_number: fulfillment.trackingNumber,
        tracking_company: fulfillment.trackingCompany,
        tracking_urls: fulfillment.trackingUrls,
        notify_customer: fulfillment.notifyCustomer ?? true,
        line_items: fulfillment.lineItems?.map(item => ({
          id: item.id,
          quantity: item.quantity,
        })),
      },
    };

    const response = await this.client.request<{ fulfillment: Record<string, unknown> }>(
      `/orders/${orderId}/fulfillments.json`,
      { method: 'POST', body }
    );

    return this.transformFulfillment(response.fulfillment);
  }

  /**
   * List fulfillments for an order
   */
  async listFulfillments(orderId: number): Promise<Fulfillment[]> {
    const response = await this.client.request<{ fulfillments: Record<string, unknown>[] }>(
      `/orders/${orderId}/fulfillments.json`
    );

    return response.fulfillments.map(f => this.transformFulfillment(f));
  }

  /**
   * Transform API response to our types
   */
  private transformOrder(order: Record<string, unknown>): Order {
    return {
      id: order.id as number,
      adminGraphqlApiId: order.admin_graphql_api_id as string,
      appId: order.app_id as number | undefined,
      browserIp: order.browser_ip as string | undefined,
      buyerAcceptsMarketing: order.buyer_accepts_marketing as boolean,
      cancelReason: order.cancel_reason as string | undefined,
      cancelledAt: order.cancelled_at as string | undefined,
      cartToken: order.cart_token as string | undefined,
      checkoutId: order.checkout_id as number | undefined,
      checkoutToken: order.checkout_token as string | undefined,
      closedAt: order.closed_at as string | undefined,
      confirmed: order.confirmed as boolean,
      contactEmail: order.contact_email as string | undefined,
      createdAt: order.created_at as string,
      currency: order.currency as string,
      currentSubtotalPrice: order.current_subtotal_price as string,
      currentTotalDiscounts: order.current_total_discounts as string,
      currentTotalPrice: order.current_total_price as string,
      currentTotalTax: order.current_total_tax as string,
      customerLocale: order.customer_locale as string | undefined,
      email: order.email as string | undefined,
      estimatedTaxes: order.estimated_taxes as boolean,
      financialStatus: order.financial_status as string,
      fulfillmentStatus: order.fulfillment_status as string | undefined,
      gateway: order.gateway as string | undefined,
      landingSite: order.landing_site as string | undefined,
      landingSiteRef: order.landing_site_ref as string | undefined,
      name: order.name as string,
      note: order.note as string | undefined,
      number: order.number as number,
      orderNumber: order.order_number as number,
      orderStatusUrl: order.order_status_url as string,
      phone: order.phone as string | undefined,
      presentmentCurrency: order.presentment_currency as string,
      processedAt: order.processed_at as string,
      referringSite: order.referring_site as string | undefined,
      sourceIdentifier: order.source_identifier as string | undefined,
      sourceName: order.source_name as string,
      subtotalPrice: order.subtotal_price as string,
      tags: order.tags as string,
      taxExempt: order.tax_exempt as boolean,
      taxesIncluded: order.taxes_included as boolean,
      test: order.test as boolean,
      token: order.token as string,
      totalDiscounts: order.total_discounts as string,
      totalLineItemsPrice: order.total_line_items_price as string,
      totalOutstanding: order.total_outstanding as string,
      totalPrice: order.total_price as string,
      totalPriceUsd: order.total_price_usd as string,
      totalShippingPriceSet: this.transformMoneySet(order.total_shipping_price_set as Record<string, unknown>),
      totalTax: order.total_tax as string,
      totalTipReceived: order.total_tip_received as string,
      totalWeight: order.total_weight as number,
      updatedAt: order.updated_at as string,
      customer: order.customer ? this.transformCustomer(order.customer as Record<string, unknown>) : undefined,
      lineItems: this.transformLineItems(order.line_items as Record<string, unknown>[] || []),
      shippingAddress: order.shipping_address ? this.transformAddress(order.shipping_address as Record<string, unknown>) : undefined,
      billingAddress: order.billing_address ? this.transformAddress(order.billing_address as Record<string, unknown>) : undefined,
      fulfillments: (order.fulfillments as Record<string, unknown>[] || []).map(f => this.transformFulfillment(f)),
      refunds: (order.refunds as Record<string, unknown>[] || []).map(r => this.transformRefund(r)),
    };
  }

  private transformOrders(orders: Record<string, unknown>[]): Order[] {
    return orders.map(o => this.transformOrder(o));
  }

  private transformLineItems(items: Record<string, unknown>[]): LineItem[] {
    return items.map(item => ({
      id: item.id as number,
      adminGraphqlApiId: item.admin_graphql_api_id as string,
      fulfillableQuantity: item.fulfillable_quantity as number,
      fulfillmentService: item.fulfillment_service as string,
      fulfillmentStatus: item.fulfillment_status as string | undefined,
      giftCard: item.gift_card as boolean,
      grams: item.grams as number,
      name: item.name as string,
      price: item.price as string,
      priceSet: this.transformMoneySet(item.price_set as Record<string, unknown>),
      productExists: item.product_exists as boolean,
      productId: item.product_id as number | undefined,
      quantity: item.quantity as number,
      requiresShipping: item.requires_shipping as boolean,
      sku: item.sku as string | undefined,
      taxable: item.taxable as boolean,
      title: item.title as string,
      totalDiscount: item.total_discount as string,
      variantId: item.variant_id as number | undefined,
      variantInventoryManagement: item.variant_inventory_management as string | undefined,
      variantTitle: item.variant_title as string | undefined,
      vendor: item.vendor as string | undefined,
    }));
  }

  private transformMoneySet(moneySet: Record<string, unknown>): MoneySet {
    const shopMoney = moneySet.shop_money as Record<string, unknown>;
    const presentmentMoney = moneySet.presentment_money as Record<string, unknown>;
    return {
      shopMoney: {
        amount: shopMoney?.amount as string || '0.00',
        currencyCode: shopMoney?.currency_code as string || 'USD',
      },
      presentmentMoney: {
        amount: presentmentMoney?.amount as string || '0.00',
        currencyCode: presentmentMoney?.currency_code as string || 'USD',
      },
    };
  }

  private transformCustomer(customer: Record<string, unknown>): Customer {
    return {
      id: customer.id as number,
      email: customer.email as string | undefined,
      acceptsMarketing: customer.accepts_marketing as boolean,
      createdAt: customer.created_at as string,
      updatedAt: customer.updated_at as string,
      firstName: customer.first_name as string | undefined,
      lastName: customer.last_name as string | undefined,
      ordersCount: customer.orders_count as number,
      state: customer.state as string,
      totalSpent: customer.total_spent as string,
      lastOrderId: customer.last_order_id as number | undefined,
      note: customer.note as string | undefined,
      verifiedEmail: customer.verified_email as boolean,
      multipassIdentifier: customer.multipass_identifier as string | undefined,
      taxExempt: customer.tax_exempt as boolean,
      tags: customer.tags as string,
      lastOrderName: customer.last_order_name as string | undefined,
      currency: customer.currency as string,
      phone: customer.phone as string | undefined,
      addresses: (customer.addresses as Record<string, unknown>[] || []).map(a => this.transformAddress(a)),
      acceptsMarketingUpdatedAt: customer.accepts_marketing_updated_at as string | undefined,
      marketingOptInLevel: customer.marketing_opt_in_level as string | undefined,
      taxExemptions: customer.tax_exemptions as string[] || [],
      adminGraphqlApiId: customer.admin_graphql_api_id as string,
      defaultAddress: customer.default_address ? this.transformAddress(customer.default_address as Record<string, unknown>) : undefined,
    };
  }

  private transformAddress(address: Record<string, unknown>): Address {
    return {
      id: address.id as number | undefined,
      customerId: address.customer_id as number | undefined,
      firstName: address.first_name as string | undefined,
      lastName: address.last_name as string | undefined,
      company: address.company as string | undefined,
      address1: address.address1 as string | undefined,
      address2: address.address2 as string | undefined,
      city: address.city as string | undefined,
      province: address.province as string | undefined,
      country: address.country as string | undefined,
      zip: address.zip as string | undefined,
      phone: address.phone as string | undefined,
      name: address.name as string | undefined,
      provinceCode: address.province_code as string | undefined,
      countryCode: address.country_code as string | undefined,
      countryName: address.country_name as string | undefined,
      default: address.default as boolean | undefined,
    };
  }

  private transformFulfillment(fulfillment: Record<string, unknown>): Fulfillment {
    return {
      id: fulfillment.id as number,
      adminGraphqlApiId: fulfillment.admin_graphql_api_id as string,
      createdAt: fulfillment.created_at as string,
      lineItems: this.transformLineItems(fulfillment.line_items as Record<string, unknown>[] || []),
      locationId: fulfillment.location_id as number,
      name: fulfillment.name as string,
      orderId: fulfillment.order_id as number,
      originAddress: fulfillment.origin_address ? this.transformAddress(fulfillment.origin_address as Record<string, unknown>) : undefined,
      receipt: fulfillment.receipt as Record<string, unknown> | undefined,
      service: fulfillment.service as string,
      shipmentStatus: fulfillment.shipment_status as string | undefined,
      status: fulfillment.status as string,
      trackingCompany: fulfillment.tracking_company as string | undefined,
      trackingNumbers: fulfillment.tracking_numbers as string[] || [],
      trackingUrls: fulfillment.tracking_urls as string[] || [],
      updatedAt: fulfillment.updated_at as string,
    };
  }

  private transformRefund(refund: Record<string, unknown>): Refund {
    return {
      id: refund.id as number,
      adminGraphqlApiId: refund.admin_graphql_api_id as string,
      createdAt: refund.created_at as string,
      note: refund.note as string | undefined,
      orderId: refund.order_id as number,
      processedAt: refund.processed_at as string,
      restock: refund.restock as boolean,
      userId: refund.user_id as number | undefined,
    };
  }
}
