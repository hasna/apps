// Lemon Squeezy Connector
// Digital products, subscriptions, and license keys

import { LemonSqueezyClient } from './client';
import type {
  LemonSqueezyConfig,
  JsonApiResponse,
  JsonApiListResponse,
  UserAttributes,
  StoreAttributes,
  ProductAttributes,
  VariantAttributes,
  OrderAttributes,
  SubscriptionAttributes,
  CustomerAttributes,
  LicenseKeyAttributes,
  LicenseKeyInstanceAttributes,
  DiscountAttributes,
  WebhookAttributes,
} from '../types';

export { LemonSqueezyClient } from './client';

export class LemonSqueezy {
  private client: LemonSqueezyClient;

  constructor(config: LemonSqueezyConfig) {
    this.client = new LemonSqueezyClient(config);
  }

  // ============================================
  // User
  // ============================================

  /**
   * Get the authenticated user
   */
  async getAuthenticatedUser(): Promise<JsonApiResponse<UserAttributes>> {
    return this.client.get('/v1/users/me');
  }

  // ============================================
  // Stores
  // ============================================

  /**
   * List all stores
   */
  async listStores(params?: {
    page?: number;
    perPage?: number;
  }): Promise<JsonApiListResponse<StoreAttributes>> {
    return this.client.get('/v1/stores', {
      'page[number]': params?.page,
      'page[size]': params?.perPage,
    });
  }

  /**
   * Get a store by ID
   */
  async getStore(storeId: string): Promise<JsonApiResponse<StoreAttributes>> {
    return this.client.get(`/v1/stores/${storeId}`);
  }

  // ============================================
  // Products
  // ============================================

  /**
   * List all products
   */
  async listProducts(params?: {
    storeId?: string;
    page?: number;
    perPage?: number;
  }): Promise<JsonApiListResponse<ProductAttributes>> {
    return this.client.get('/v1/products', {
      'filter[store_id]': params?.storeId,
      'page[number]': params?.page,
      'page[size]': params?.perPage,
    });
  }

  /**
   * Get a product by ID
   */
  async getProduct(productId: string): Promise<JsonApiResponse<ProductAttributes>> {
    return this.client.get(`/v1/products/${productId}`);
  }

  // ============================================
  // Variants
  // ============================================

  /**
   * List all variants
   */
  async listVariants(params?: {
    productId?: string;
    page?: number;
    perPage?: number;
  }): Promise<JsonApiListResponse<VariantAttributes>> {
    return this.client.get('/v1/variants', {
      'filter[product_id]': params?.productId,
      'page[number]': params?.page,
      'page[size]': params?.perPage,
    });
  }

  /**
   * Get a variant by ID
   */
  async getVariant(variantId: string): Promise<JsonApiResponse<VariantAttributes>> {
    return this.client.get(`/v1/variants/${variantId}`);
  }

  // ============================================
  // Orders
  // ============================================

  /**
   * List all orders
   */
  async listOrders(params?: {
    storeId?: string;
    userEmail?: string;
    page?: number;
    perPage?: number;
  }): Promise<JsonApiListResponse<OrderAttributes>> {
    return this.client.get('/v1/orders', {
      'filter[store_id]': params?.storeId,
      'filter[user_email]': params?.userEmail,
      'page[number]': params?.page,
      'page[size]': params?.perPage,
    });
  }

  /**
   * Get an order by ID
   */
  async getOrder(orderId: string): Promise<JsonApiResponse<OrderAttributes>> {
    return this.client.get(`/v1/orders/${orderId}`);
  }

  // ============================================
  // Subscriptions
  // ============================================

  /**
   * List all subscriptions
   */
  async listSubscriptions(params?: {
    storeId?: string;
    orderId?: string;
    productId?: string;
    variantId?: string;
    status?: string;
    page?: number;
    perPage?: number;
  }): Promise<JsonApiListResponse<SubscriptionAttributes>> {
    return this.client.get('/v1/subscriptions', {
      'filter[store_id]': params?.storeId,
      'filter[order_id]': params?.orderId,
      'filter[product_id]': params?.productId,
      'filter[variant_id]': params?.variantId,
      'filter[status]': params?.status,
      'page[number]': params?.page,
      'page[size]': params?.perPage,
    });
  }

  /**
   * Get a subscription by ID
   */
  async getSubscription(subscriptionId: string): Promise<JsonApiResponse<SubscriptionAttributes>> {
    return this.client.get(`/v1/subscriptions/${subscriptionId}`);
  }

  /**
   * Update a subscription
   */
  async updateSubscription(subscriptionId: string, data: {
    variantId?: number;
    pause?: { mode: 'void' | 'free' } | null;
    cancelled?: boolean;
    billingAnchor?: number;
  }): Promise<JsonApiResponse<SubscriptionAttributes>> {
    const attributes: Record<string, unknown> = {};
    if (data.variantId !== undefined) attributes.variant_id = data.variantId;
    if (data.pause !== undefined) attributes.pause = data.pause;
    if (data.cancelled !== undefined) attributes.cancelled = data.cancelled;
    if (data.billingAnchor !== undefined) attributes.billing_anchor = data.billingAnchor;

    return this.client.patch(`/v1/subscriptions/${subscriptionId}`, {
      data: {
        type: 'subscriptions',
        id: subscriptionId,
        attributes,
      },
    });
  }

  /**
   * Cancel a subscription
   */
  async cancelSubscription(subscriptionId: string): Promise<JsonApiResponse<SubscriptionAttributes>> {
    return this.updateSubscription(subscriptionId, { cancelled: true });
  }

  /**
   * Pause a subscription
   */
  async pauseSubscription(subscriptionId: string, mode: 'void' | 'free' = 'void'): Promise<JsonApiResponse<SubscriptionAttributes>> {
    return this.updateSubscription(subscriptionId, { pause: { mode } });
  }

  /**
   * Resume a paused subscription
   */
  async resumeSubscription(subscriptionId: string): Promise<JsonApiResponse<SubscriptionAttributes>> {
    return this.updateSubscription(subscriptionId, { pause: null });
  }

  // ============================================
  // Customers
  // ============================================

  /**
   * List all customers
   */
  async listCustomers(params?: {
    storeId?: string;
    email?: string;
    page?: number;
    perPage?: number;
  }): Promise<JsonApiListResponse<CustomerAttributes>> {
    return this.client.get('/v1/customers', {
      'filter[store_id]': params?.storeId,
      'filter[email]': params?.email,
      'page[number]': params?.page,
      'page[size]': params?.perPage,
    });
  }

  /**
   * Get a customer by ID
   */
  async getCustomer(customerId: string): Promise<JsonApiResponse<CustomerAttributes>> {
    return this.client.get(`/v1/customers/${customerId}`);
  }

  // ============================================
  // License Keys
  // ============================================

  /**
   * List all license keys
   */
  async listLicenseKeys(params?: {
    storeId?: string;
    orderId?: string;
    productId?: string;
    page?: number;
    perPage?: number;
  }): Promise<JsonApiListResponse<LicenseKeyAttributes>> {
    return this.client.get('/v1/license-keys', {
      'filter[store_id]': params?.storeId,
      'filter[order_id]': params?.orderId,
      'filter[product_id]': params?.productId,
      'page[number]': params?.page,
      'page[size]': params?.perPage,
    });
  }

  /**
   * Get a license key by ID
   */
  async getLicenseKey(licenseKeyId: string): Promise<JsonApiResponse<LicenseKeyAttributes>> {
    return this.client.get(`/v1/license-keys/${licenseKeyId}`);
  }

  /**
   * Update a license key
   */
  async updateLicenseKey(licenseKeyId: string, data: {
    activationLimit?: number;
    disabled?: boolean;
    expiresAt?: string | null;
  }): Promise<JsonApiResponse<LicenseKeyAttributes>> {
    const attributes: Record<string, unknown> = {};
    if (data.activationLimit !== undefined) attributes.activation_limit = data.activationLimit;
    if (data.disabled !== undefined) attributes.disabled = data.disabled;
    if (data.expiresAt !== undefined) attributes.expires_at = data.expiresAt;

    return this.client.patch(`/v1/license-keys/${licenseKeyId}`, {
      data: {
        type: 'license-keys',
        id: licenseKeyId,
        attributes,
      },
    });
  }

  // ============================================
  // License Key Instances
  // ============================================

  /**
   * List all license key instances
   */
  async listLicenseKeyInstances(params?: {
    licenseKeyId?: string;
    page?: number;
    perPage?: number;
  }): Promise<JsonApiListResponse<LicenseKeyInstanceAttributes>> {
    return this.client.get('/v1/license-key-instances', {
      'filter[license_key_id]': params?.licenseKeyId,
      'page[number]': params?.page,
      'page[size]': params?.perPage,
    });
  }

  /**
   * Get a license key instance by ID
   */
  async getLicenseKeyInstance(instanceId: string): Promise<JsonApiResponse<LicenseKeyInstanceAttributes>> {
    return this.client.get(`/v1/license-key-instances/${instanceId}`);
  }

  // ============================================
  // Discounts
  // ============================================

  /**
   * List all discounts
   */
  async listDiscounts(params?: {
    storeId?: string;
    page?: number;
    perPage?: number;
  }): Promise<JsonApiListResponse<DiscountAttributes>> {
    return this.client.get('/v1/discounts', {
      'filter[store_id]': params?.storeId,
      'page[number]': params?.page,
      'page[size]': params?.perPage,
    });
  }

  /**
   * Get a discount by ID
   */
  async getDiscount(discountId: string): Promise<JsonApiResponse<DiscountAttributes>> {
    return this.client.get(`/v1/discounts/${discountId}`);
  }

  /**
   * Create a discount
   */
  async createDiscount(data: {
    storeId: number;
    name: string;
    code: string;
    amount: number;
    amountType: 'percent' | 'fixed';
    isLimitedToProducts?: boolean;
    isLimitedRedemptions?: boolean;
    maxRedemptions?: number;
    startsAt?: string;
    expiresAt?: string;
    duration?: 'once' | 'repeating' | 'forever';
    durationInMonths?: number;
  }): Promise<JsonApiResponse<DiscountAttributes>> {
    const attributes: Record<string, unknown> = {
      name: data.name,
      code: data.code,
      amount: data.amount,
      amount_type: data.amountType,
    };

    if (data.isLimitedToProducts !== undefined) attributes.is_limited_to_products = data.isLimitedToProducts;
    if (data.isLimitedRedemptions !== undefined) attributes.is_limited_redemptions = data.isLimitedRedemptions;
    if (data.maxRedemptions !== undefined) attributes.max_redemptions = data.maxRedemptions;
    if (data.startsAt !== undefined) attributes.starts_at = data.startsAt;
    if (data.expiresAt !== undefined) attributes.expires_at = data.expiresAt;
    if (data.duration !== undefined) attributes.duration = data.duration;
    if (data.durationInMonths !== undefined) attributes.duration_in_months = data.durationInMonths;

    return this.client.post('/v1/discounts', {
      data: {
        type: 'discounts',
        attributes,
        relationships: {
          store: {
            data: {
              type: 'stores',
              id: String(data.storeId),
            },
          },
        },
      },
    });
  }

  /**
   * Delete a discount
   */
  async deleteDiscount(discountId: string): Promise<void> {
    await this.client.delete(`/v1/discounts/${discountId}`);
  }

  // ============================================
  // Webhooks
  // ============================================

  /**
   * List all webhooks
   */
  async listWebhooks(params?: {
    storeId?: string;
    page?: number;
    perPage?: number;
  }): Promise<JsonApiListResponse<WebhookAttributes>> {
    return this.client.get('/v1/webhooks', {
      'filter[store_id]': params?.storeId,
      'page[number]': params?.page,
      'page[size]': params?.perPage,
    });
  }

  /**
   * Get a webhook by ID
   */
  async getWebhook(webhookId: string): Promise<JsonApiResponse<WebhookAttributes>> {
    return this.client.get(`/v1/webhooks/${webhookId}`);
  }

  /**
   * Create a webhook
   */
  async createWebhook(data: {
    storeId: number;
    url: string;
    events: string[];
    secret: string;
  }): Promise<JsonApiResponse<WebhookAttributes>> {
    return this.client.post('/v1/webhooks', {
      data: {
        type: 'webhooks',
        attributes: {
          url: data.url,
          events: data.events,
          secret: data.secret,
        },
        relationships: {
          store: {
            data: {
              type: 'stores',
              id: String(data.storeId),
            },
          },
        },
      },
    });
  }

  /**
   * Update a webhook
   */
  async updateWebhook(webhookId: string, data: {
    url?: string;
    events?: string[];
    secret?: string;
  }): Promise<JsonApiResponse<WebhookAttributes>> {
    const attributes: Record<string, unknown> = {};
    if (data.url !== undefined) attributes.url = data.url;
    if (data.events !== undefined) attributes.events = data.events;
    if (data.secret !== undefined) attributes.secret = data.secret;

    return this.client.patch(`/v1/webhooks/${webhookId}`, {
      data: {
        type: 'webhooks',
        id: webhookId,
        attributes,
      },
    });
  }

  /**
   * Delete a webhook
   */
  async deleteWebhook(webhookId: string): Promise<void> {
    await this.client.delete(`/v1/webhooks/${webhookId}`);
  }

  /**
   * Get API key preview for debugging
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}
