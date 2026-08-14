import type { MenusResponse } from '../types';
import type { ToastClient } from './client';

export class MenusApi {
  constructor(private readonly client: ToastClient) {}

  async getMenus(): Promise<MenusResponse> {
    return this.client.get<MenusResponse>('/menus/v3/menus');
  }
}
