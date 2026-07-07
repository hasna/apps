import type { RestaurantInfo, RestaurantsListResponse } from '../types';
import type { ToastClient } from './client';

export class RestaurantsApi {
  constructor(private readonly client: ToastClient) {}

  async getRestaurant(
    restaurantGuid: string,
    options?: { includeArchived?: boolean },
  ): Promise<RestaurantInfo> {
    return this.client.get<RestaurantInfo>(
      `/restaurants/v1/restaurants/${encodeURIComponent(restaurantGuid)}`,
      { includeArchived: options?.includeArchived ?? false },
      { restaurantExternalId: restaurantGuid },
    );
  }

  async listRestaurantsInGroup(managementGroupGuid: string): Promise<RestaurantsListResponse> {
    return this.client.get<RestaurantsListResponse>(
      `/restaurants/v1/groups/${encodeURIComponent(managementGroupGuid)}/restaurants`,
    );
  }
}
