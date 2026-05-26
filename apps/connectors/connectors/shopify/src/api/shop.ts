import type { ShopifyClient } from './client';
import type { Shop } from '../types';

/**
 * Shopify Shop API
 */
export class ShopApi {
  constructor(private readonly client: ShopifyClient) {}

  /**
   * Get shop information
   */
  async get(): Promise<Shop> {
    const response = await this.client.request<{ shop: Record<string, unknown> }>(
      '/shop.json'
    );

    return this.transformShop(response.shop);
  }

  /**
   * Transform API response to our types
   */
  private transformShop(shop: Record<string, unknown>): Shop {
    return {
      id: shop.id as number,
      name: shop.name as string,
      email: shop.email as string,
      domain: shop.domain as string,
      province: shop.province as string | undefined,
      country: shop.country as string | undefined,
      address1: shop.address1 as string | undefined,
      zip: shop.zip as string | undefined,
      city: shop.city as string | undefined,
      phone: shop.phone as string | undefined,
      currency: shop.currency as string,
      timezone: shop.timezone as string,
      ianaTimezone: shop.iana_timezone as string,
      shopOwner: shop.shop_owner as string,
      moneyFormat: shop.money_format as string,
      moneyWithCurrencyFormat: shop.money_with_currency_format as string,
      weightUnit: shop.weight_unit as string,
      planName: shop.plan_name as string,
      planDisplayName: shop.plan_display_name as string,
      hasStorefront: shop.has_storefront as boolean,
      createdAt: shop.created_at as string,
      updatedAt: shop.updated_at as string,
    };
  }
}
