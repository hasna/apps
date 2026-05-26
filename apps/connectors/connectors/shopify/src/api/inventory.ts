import type { ShopifyClient } from './client';
import type { InventoryLevel, InventoryItem, Location, SetInventoryLevelRequest, AdjustInventoryLevelRequest } from '../types';

export interface ListInventoryLevelsOptions {
  inventoryItemIds?: number[];
  locationIds?: number[];
  limit?: number;
  updatedAtMin?: string;
}

/**
 * Shopify Inventory API
 */
export class InventoryApi {
  constructor(private readonly client: ShopifyClient) {}

  /**
   * List inventory levels
   */
  async listLevels(options: ListInventoryLevelsOptions = {}): Promise<InventoryLevel[]> {
    const params: Record<string, string | number | boolean | undefined> = {
      limit: options.limit || 50,
    };

    if (options.inventoryItemIds && options.inventoryItemIds.length > 0) {
      params.inventory_item_ids = options.inventoryItemIds.join(',');
    }
    if (options.locationIds && options.locationIds.length > 0) {
      params.location_ids = options.locationIds.join(',');
    }
    if (options.updatedAtMin) params.updated_at_min = options.updatedAtMin;

    const response = await this.client.request<{ inventory_levels: Record<string, unknown>[] }>(
      '/inventory_levels.json',
      { params }
    );

    return this.transformInventoryLevels(response.inventory_levels);
  }

  /**
   * Set inventory level
   */
  async setLevel(request: SetInventoryLevelRequest): Promise<InventoryLevel> {
    const body = {
      location_id: request.locationId,
      inventory_item_id: request.inventoryItemId,
      available: request.available,
    };

    const response = await this.client.request<{ inventory_level: Record<string, unknown> }>(
      '/inventory_levels/set.json',
      { method: 'POST', body }
    );

    return this.transformInventoryLevel(response.inventory_level);
  }

  /**
   * Adjust inventory level
   */
  async adjustLevel(request: AdjustInventoryLevelRequest): Promise<InventoryLevel> {
    const body = {
      location_id: request.locationId,
      inventory_item_id: request.inventoryItemId,
      available_adjustment: request.availableAdjustment,
    };

    const response = await this.client.request<{ inventory_level: Record<string, unknown> }>(
      '/inventory_levels/adjust.json',
      { method: 'POST', body }
    );

    return this.transformInventoryLevel(response.inventory_level);
  }

  /**
   * Connect inventory item to location
   */
  async connect(inventoryItemId: number, locationId: number): Promise<InventoryLevel> {
    const body = {
      location_id: locationId,
      inventory_item_id: inventoryItemId,
    };

    const response = await this.client.request<{ inventory_level: Record<string, unknown> }>(
      '/inventory_levels/connect.json',
      { method: 'POST', body }
    );

    return this.transformInventoryLevel(response.inventory_level);
  }

  /**
   * Get an inventory item
   */
  async getItem(id: number): Promise<InventoryItem> {
    const response = await this.client.request<{ inventory_item: Record<string, unknown> }>(
      `/inventory_items/${id}.json`
    );

    return this.transformInventoryItem(response.inventory_item);
  }

  /**
   * List inventory items
   */
  async listItems(ids: number[], limit?: number): Promise<InventoryItem[]> {
    const params: Record<string, string | number | boolean | undefined> = {
      ids: ids.join(','),
      limit: limit || 50,
    };

    const response = await this.client.request<{ inventory_items: Record<string, unknown>[] }>(
      '/inventory_items.json',
      { params }
    );

    return response.inventory_items.map(item => this.transformInventoryItem(item));
  }

  /**
   * Update an inventory item
   */
  async updateItem(id: number, data: { sku?: string; cost?: string; tracked?: boolean }): Promise<InventoryItem> {
    const body = {
      inventory_item: {
        id,
        sku: data.sku,
        cost: data.cost,
        tracked: data.tracked,
      },
    };

    const response = await this.client.request<{ inventory_item: Record<string, unknown> }>(
      `/inventory_items/${id}.json`,
      { method: 'PUT', body }
    );

    return this.transformInventoryItem(response.inventory_item);
  }

  /**
   * List locations
   */
  async listLocations(): Promise<Location[]> {
    const response = await this.client.request<{ locations: Record<string, unknown>[] }>(
      '/locations.json'
    );

    return response.locations.map(loc => this.transformLocation(loc));
  }

  /**
   * Get a location
   */
  async getLocation(id: number): Promise<Location> {
    const response = await this.client.request<{ location: Record<string, unknown> }>(
      `/locations/${id}.json`
    );

    return this.transformLocation(response.location);
  }

  /**
   * Get inventory levels at a location
   */
  async getLevelsAtLocation(locationId: number): Promise<InventoryLevel[]> {
    const response = await this.client.request<{ inventory_levels: Record<string, unknown>[] }>(
      `/locations/${locationId}/inventory_levels.json`
    );

    return this.transformInventoryLevels(response.inventory_levels);
  }

  /**
   * Transform API response
   */
  private transformInventoryLevel(level: Record<string, unknown>): InventoryLevel {
    return {
      inventoryItemId: level.inventory_item_id as number,
      locationId: level.location_id as number,
      available: level.available as number | undefined,
      updatedAt: level.updated_at as string,
      adminGraphqlApiId: level.admin_graphql_api_id as string,
    };
  }

  private transformInventoryLevels(levels: Record<string, unknown>[]): InventoryLevel[] {
    return levels.map(l => this.transformInventoryLevel(l));
  }

  private transformInventoryItem(item: Record<string, unknown>): InventoryItem {
    return {
      id: item.id as number,
      sku: item.sku as string | undefined,
      createdAt: item.created_at as string,
      updatedAt: item.updated_at as string,
      requiresShipping: item.requires_shipping as boolean,
      cost: item.cost as string | undefined,
      countryCodeOfOrigin: item.country_code_of_origin as string | undefined,
      provinceCodeOfOrigin: item.province_code_of_origin as string | undefined,
      harmonizedSystemCode: item.harmonized_system_code as string | undefined,
      tracked: item.tracked as boolean,
      countryHarmonizedSystemCodes: (item.country_harmonized_system_codes as Record<string, unknown>[] || []).map(c => ({
        harmonizedSystemCode: c.harmonized_system_code as string,
        countryCode: c.country_code as string,
      })),
      adminGraphqlApiId: item.admin_graphql_api_id as string,
    };
  }

  private transformLocation(location: Record<string, unknown>): Location {
    return {
      id: location.id as number,
      name: location.name as string,
      address1: location.address1 as string | undefined,
      address2: location.address2 as string | undefined,
      city: location.city as string | undefined,
      zip: location.zip as string | undefined,
      province: location.province as string | undefined,
      country: location.country as string | undefined,
      countryCode: location.country_code as string | undefined,
      countryName: location.country_name as string | undefined,
      phone: location.phone as string | undefined,
      provinceCode: location.province_code as string | undefined,
      createdAt: location.created_at as string,
      updatedAt: location.updated_at as string,
      legacy: location.legacy as boolean,
      active: location.active as boolean,
      adminGraphqlApiId: location.admin_graphql_api_id as string,
      localizedCountryName: location.localized_country_name as string | undefined,
      localizedProvinceName: location.localized_province_name as string | undefined,
    };
  }
}
