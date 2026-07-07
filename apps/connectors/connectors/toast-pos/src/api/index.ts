import type { ToastConfig, MenusResponse, Order, OrdersBulkResponse, RestaurantInfo, RestaurantsListResponse } from '../types';
import { ToastClient } from './client';
import { RestaurantsApi } from './restaurants';
import { MenusApi } from './menus';
import { OrdersApi } from './orders';
import { loginWithMachineClient } from './auth';

export class ToastPos {
  private readonly config: ToastConfig;
  private readonly client: ToastClient;
  readonly restaurants: RestaurantsApi;
  readonly menus: MenusApi;
  readonly orders: OrdersApi;

  constructor(config: ToastConfig) {
    this.config = config;
    this.client = new ToastClient(config);
    this.restaurants = new RestaurantsApi(this.client);
    this.menus = new MenusApi(this.client);
    this.orders = new OrdersApi(this.client);
  }

  static fromEnv(): ToastPos {
    const clientId = process.env.TOAST_CLIENT_ID;
    const clientSecret = process.env.TOAST_CLIENT_SECRET;
    const restaurantExternalId = process.env.TOAST_RESTAURANT_EXTERNAL_ID;
    const baseUrl = process.env.TOAST_BASE_URL;

    if (!clientId || !clientSecret || !restaurantExternalId) {
      throw new Error(
        'TOAST_CLIENT_ID, TOAST_CLIENT_SECRET, and TOAST_RESTAURANT_EXTERNAL_ID are required',
      );
    }

    return new ToastPos({ clientId, clientSecret, restaurantExternalId, baseUrl });
  }

  async authenticate(): Promise<void> {
    await loginWithMachineClient({
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      baseUrl: this.config.baseUrl,
    });
  }

  getClient(): ToastClient {
    return this.client;
  }

  async getRestaurant(restaurantGuid: string, options?: { includeArchived?: boolean }): Promise<RestaurantInfo> {
    return this.restaurants.getRestaurant(restaurantGuid, options);
  }

  async listRestaurantsInGroup(managementGroupGuid: string): Promise<RestaurantsListResponse> {
    return this.restaurants.listRestaurantsInGroup(managementGroupGuid);
  }

  async getMenus(): Promise<MenusResponse> {
    return this.menus.getMenus();
  }

  async getOrder(orderGuid: string): Promise<Order> {
    return this.orders.getOrder(orderGuid);
  }

  async listOrdersBulk(options?: {
    startDate?: string;
    endDate?: string;
    businessDate?: string;
    pageSize?: number;
    pageToken?: string;
  }): Promise<OrdersBulkResponse> {
    return this.orders.listOrdersBulk(options);
  }

  async rawRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    path: string,
    options?: {
      params?: Record<string, string | number | boolean | undefined>;
      body?: Record<string, unknown> | unknown[] | string;
      restaurantExternalId?: string;
    },
  ): Promise<T> {
    return this.client.request<T>(path, {
      method,
      params: options?.params,
      body: options?.body,
      restaurantExternalId: options?.restaurantExternalId,
    });
  }
}

export { ToastClient } from './client';
export { loginWithMachineClient, getValidAccessToken, DEFAULT_BASE_URL, AUTH_LOGIN_PATH } from './auth';
