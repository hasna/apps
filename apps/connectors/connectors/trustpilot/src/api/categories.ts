import type { TrustpilotClient } from './client';
import type { CategoryBusinessUnitsOptions, CategoryGetOptions, CategoryListOptions } from '../types';

export class CategoriesApi {
  constructor(private readonly client: TrustpilotClient) {}

  async list(options: CategoryListOptions = {}): Promise<unknown> {
    return this.client.get('/categories', {
      country: options.country,
      locale: options.locale,
      parentId: options.parentId,
      depth: options.depth,
    }, 'apikey');
  }

  async get(options: CategoryGetOptions): Promise<unknown> {
    return this.client.get(`/categories/${encodeURIComponent(options.categoryId)}`, {
      country: options.country,
      locale: options.locale,
    }, 'apikey');
  }

  async getBusinessUnits(options: CategoryBusinessUnitsOptions): Promise<unknown> {
    return this.client.get(`/categories/${encodeURIComponent(options.categoryId)}/business-units`, {
      country: options.country,
      locale: options.locale,
      perPage: options.perPage,
      page: options.page,
    }, 'apikey');
  }
}
