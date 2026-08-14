import type { Icons8Client } from './client';
import type { Icon, IconSearchResponse, IconSearchParams, CategoriesResponse, PlatformsResponse } from '../types';

/**
 * Icons API module - provides access to Icons8 icon search and retrieval
 */
export class IconsApi {
  constructor(private readonly client: Icons8Client) {}

  /**
   * Search for icons by term
   */
  async search(params: IconSearchParams): Promise<IconSearchResponse> {
    return this.client.get<IconSearchResponse>('/api/iconsets/v5/search', {
      term: params.term,
      amount: params.amount,
      offset: params.offset,
      platform: params.platform,
      language: params.language,
    });
  }

  /**
   * Get a single icon by ID
   */
  async get(id: string): Promise<Icon> {
    const response = await this.client.get<{ icon: Icon }>(`/api/iconsets/v5/icon`, {
      id,
    });
    return response.icon;
  }

  /**
   * List all available categories
   */
  async listCategories(platform?: string): Promise<CategoriesResponse> {
    return this.client.get<CategoriesResponse>('/api/iconsets/v5/categories', {
      platform,
    });
  }

  /**
   * List all available platforms/styles
   */
  async listPlatforms(): Promise<PlatformsResponse> {
    return this.client.get<PlatformsResponse>('/api/iconsets/v5/platforms');
  }

  /**
   * Get icons by category
   */
  async listByCategory(category: string, options?: {
    amount?: number;
    offset?: number;
    platform?: string;
  }): Promise<IconSearchResponse> {
    return this.client.get<IconSearchResponse>('/api/iconsets/v5/category', {
      category,
      amount: options?.amount,
      offset: options?.offset,
      platform: options?.platform,
    });
  }
}
